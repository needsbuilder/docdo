import { NextResponse } from "next/server";
import { store, type DocPatch, type DocRow, type AgentInput } from "@/lib/store";
import { fetchJob, deleteFile } from "@/lib/upstage";
import { verify } from "@/lib/verify";
import { buildPhrases } from "@/lib/phrase";
import { getSession, readElderToken, NO_STORE } from "@/lib/auth";
import { toElderDoc, toGuardianDoc } from "@/lib/dto";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const TERMINAL = new Set(["completed", "failed"]);
const PENDING = new Set(["queued", "in_progress"]);

type Caller = { kind: "guardian" } | { kind: "elder" } | null;

/** 누가 이 문서를 볼 수 있는가. 보호자는 세션의 가구, 어르신은 초대 토큰의 가구가 문서 가구와 같아야 한다.
 *  둘 다 아니면 문서는 **존재하지 않는 것**으로 답한다(404). 존재 여부 자체가 정보다. */
async function caller(req: Request, doc: DocRow): Promise<Caller> {
  const s = getSession(req);
  if (s && s.householdId === doc.household_id) return { kind: "guardian" };
  const token = readElderToken(req);
  if (token) {
    const g = await store().guardianByElderToken(token).catch(() => null);
    if (g && g.household_id === doc.household_id) return { kind: "elder" };
  }
  return null;
}

function shape(c: Caller, row: DocRow & { error?: string }) {
  return c?.kind === "guardian" ? toGuardianDoc(row) : toElderDoc(row);
}

/** 요청당 Upstage 를 딱 1회 조회한다. 폴링은 브라우저가 한다. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = store();
  const doc = await db.get(id);
  if (!doc) return json({ error: "없음" }, 404);
  const c = await caller(req, doc);
  if (!c) return json({ error: "없음" }, 404);

  // 이미 판정이 끝난 문서는 다시 Upstage 를 부르지 않는다.
  // 지난번 삭제가 실패했으면 여기서 한 번 더 시도한다.
  if (doc.result) {
    if (doc.upstage_file_id && doc.upstage_file_id !== "delete_pending") {
      const ok = await deleteFile(doc.upstage_file_id);
      await db.update(id, { upstage_file_id: ok ? null : "delete_pending" }).catch(() => {});
    }
    return json(shape(c, doc));
  }

  if (doc.pipeline_status === "uploading" || !doc.upstage_job_id) {
    if (doc.pipeline_status === "failed") {
      return json(shape(c, { ...doc, error: "문서 처리 서비스에 연결하지 못했습니다" }));
    }
    return json(shape(c, doc));
  }

  let job;
  try {
    job = await fetchJob(doc.upstage_job_id);
  } catch (e) {
    console.error("[documents] fetchJob 실패", id, e);
    // 일시적일 수 있다. 종결로 굳히지 않고 다시 물어보게 한다.
    return json({ ...shape(c, doc), pipeline_status: "retry" }, 503);
  }

  const status = typeof job.status === "string" ? job.status : "";
  if (PENDING.has(status)) {
    await db.update(id, { pipeline_status: status });
    return json(shape(c, { ...doc, pipeline_status: status }));
  }
  if (!TERMINAL.has(status)) {
    // 알 수 없는 상태. 원본을 지우지 않고 실패로 굳힌다.
    console.error("[documents] 알 수 없는 job status", id, status);
    const updated = await db.update(id, { pipeline_status: "failed" });
    return json(shape(c, { ...(updated ?? doc), error: "문서 처리 결과를 해석하지 못했습니다" }));
  }

  // failed 는 종결 상태다. 같은 job_id 재조회로는 안 되므로 결과를 그대로 굳힌다.
  const result = verify(job);
  const phrases = buildPhrases(result);
  const updated = await db.update(id, {
    pipeline_status: status,
    action_type: result.actionType ?? null,
    verdict: result.verdict,
    result,
    phrases,
  });
  // 원본 사진은 판독이 끝나면 지운다. 실패하면 표시해 두고 다음 조회에서 다시 시도한다.
  if (doc.upstage_file_id) {
    const ok = await deleteFile(doc.upstage_file_id);
    await db.update(id, { upstage_file_id: ok ? null : doc.upstage_file_id }).catch(() => {});
  }
  return json(shape(c, updated ?? { ...doc, result, phrases, verdict: result.verdict }));
}

// 보호자의 처리 상태. 한 방향으로만 간다. done 은 종결이다.
const NEXT: Record<string, ReadonlySet<string>> = {
  new: new Set(["acknowledged", "done"]),
  acknowledged: new Set(["done"]),
  done: new Set(),
};

/** 보호자 전용. 어르신 화면에는 이 경로가 없다. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = getSession(req);
  if (!s) return json({ error: "로그인이 필요합니다" }, 401);
  const { id } = await params;
  let resolution: unknown;
  let action: unknown;
  let input: unknown;
  let site: unknown;
  try {
    ({ resolution, action, input, site } = await req.json());
  } catch {
    return json({ error: "JSON 형식이 아닙니다" }, 400);
  }

  const db = store();
  const doc = await db.get(id);
  if (!doc || doc.household_id !== s.householdId) return json({ error: "없음" }, 404);

  // 처리 승인. 보호자의 명시적 행동 하나가 에이전트 실행의 유일한 시작점이다.
  // 불일치(mismatch) 문서는 승인 자체가 막힌다 — 사칭본에 돈이 나가는 경로를 두지 않는다.
  if (action === "approve") {
    if (!doc.result) return json({ error: "판정이 끝나지 않았습니다" }, 409);
    // mismatch(확정 불일치)는 승인 불가. 기관 미상·대조 불가는 허용한다 — 납부는 문서의 계좌가 아니라
    // 포털이 전자납부번호로 조회한 고지에 하므로, 진짜 가드는 워커의 "포털 조회 결과 = 문서 금액" 대조다.
    if (doc.verdict === "mismatch") return json({ error: "공식 정보와 다른 문서는 처리할 수 없습니다" }, 409);
    if ((doc.result.reasons ?? []).some((x) => x.rule === "R7")) return json({ error: "사칭이 의심되는 문서는 처리할 수 없습니다" }, 409);
    const fc = (doc.result.fieldConfidence ?? {}) as Record<string, string>;
    if (fc.epn !== "high" || fc.amount_krw !== "high") return json({ error: "전자납부번호와 금액을 확실히 읽은 문서만 처리할 수 있습니다" }, 409);
    // 워커가 죽어 running/waiting 에 박힌 문서는 15분이 지나면 다시 승인할 수 있다. 그 전엔 멱등.
    const STALE_MS = 15 * 60_000;
    const stale = doc.approved_at ? Date.now() - new Date(doc.approved_at).getTime() > STALE_MS : true;
    const active = doc.action_status === "queued" || doc.action_status === "running" || doc.action_status === "waiting";
    if (active && !stale) return json(toGuardianDoc(doc));
    if (doc.action_status === "done") return json(toGuardianDoc(doc));
    const data = await db.update(id, {
      action_status: "queued",
      action_run: crypto.randomUUID(), // 새 리스. 옛 워커의 요청은 이 값이 달라 거부된다.
      // 어디서 실행할지. demo = 시연 포털(끝까지) · giro = 실제 인터넷지로(인증서 단계에서 보호자에게 넘어감).
      action_trace: [{ t: new Date().toISOString(), title: site === "giro" ? "보호자가 실제 인터넷지로에서 처리를 승인했습니다" : "보호자가 처리를 승인했습니다", detail: site === "giro" ? "site=giro" : "site=demo" }],
      action_result: null,
      action_live: null,
      action_wait: null,
      action_inputs: [],
      approved_at: new Date().toISOString(),
      resolution_status: doc.resolution_status === "new" ? "acknowledged" : doc.resolution_status,
      reviewed_at: doc.reviewed_at ?? new Date().toISOString(),
    });
    return json(toGuardianDoc(data ?? doc));
  }
  // 보호자 폰에서 온 원격 입력(터치·키·이어서 하기). 에이전트가 멈춰 있거나 도는 중일 때만 받는다.
  if (input && typeof input === "object") {
    if (doc.action_status !== "waiting" && doc.action_status !== "running") return json({ error: "에이전트가 대기 중이 아닙니다" }, 409);
    const i = input as Record<string, unknown>;
    const id2 = crypto.randomUUID();
    let item: AgentInput | null = null;
    if (i.kind === "tap" && typeof i.x === "number" && typeof i.y === "number") item = { id: id2, kind: "tap", x: Math.round(i.x), y: Math.round(i.y) };
    else if (i.kind === "type" && typeof i.text === "string" && i.text.length <= 200) item = { id: id2, kind: "type", text: i.text };
    else if (i.kind === "key" && typeof i.key === "string" && /^[A-Za-z]{2,12}$/.test(i.key)) item = { id: id2, kind: "key", key: i.key };
    else if (i.kind === "resume") item = { id: id2, kind: "resume" };
    if (!item) return json({ error: "잘못된 입력" }, 400);
    const queue = [...(doc.action_inputs ?? []), item].slice(-50);
    const data = await db.update(id, { action_inputs: queue });
    return json(toGuardianDoc(data ?? doc));
  }
  if (typeof resolution !== "string") return json({ error: "잘못된 값" }, 400);
  const allowed = NEXT[doc.resolution_status] ?? new Set();
  if (!allowed.has(resolution)) {
    // 같은 상태로 다시 누른 것은 멱등으로 본다. 되돌리기는 거부한다.
    if (doc.resolution_status === resolution) return json(toGuardianDoc(doc));
    return json({ error: `${doc.resolution_status} → ${resolution} 으로 바꿀 수 없습니다` }, 409);
  }
  const patch: DocPatch = { resolution_status: resolution };
  patch[resolution === "done" ? "done_at" : "reviewed_at"] = new Date().toISOString();
  const data = await db.update(id, patch);
  if (!data) return json({ error: "없음" }, 404);
  return json(toGuardianDoc(data));
}
