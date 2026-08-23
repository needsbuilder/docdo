import "server-only";
import { store, type DocRow } from "@/lib/store";
import { fetchJob, deleteFile } from "@/lib/upstage";
import { verify } from "@/lib/verify";
import { buildPhrases } from "@/lib/phrase";

// 문서 한 건을 Upstage 결과로 한 걸음 진행시킨다. 요청당 Upstage 조회는 딱 1회.
// 어르신 폰의 폴링(/api/documents/[id])과 워커의 정기 점검(/api/agent/sweep)이 같은 함수를 쓴다 —
// 12:00 시연 직전에 Upstage 는 13초 만에 끝났는데 폰이 결과를 못 받아 로딩에 갇힌 적이 있다.
// 결과가 나오는 일이 폰 화면이 살아 있는지에 달려 있으면 안 된다.

const TERMINAL = new Set(["completed", "failed"]);
const PENDING = new Set(["queued", "in_progress"]);

export type Advance =
  | { kind: "done"; doc: DocRow } // 판정·문구가 실렸다(이미 실려 있던 경우 포함)
  | { kind: "pending"; doc: DocRow } // Upstage 가 아직 처리 중
  | { kind: "retry"; doc: DocRow } // Upstage 조회 실패. 일시적일 수 있다 — 종결로 굳히지 않는다
  | { kind: "failed"; doc: DocRow; error: string } // 서버가 실패로 굳혔다
  | { kind: "waiting"; doc: DocRow }; // 아직 업로드 중이라 job 이 없다

export async function advanceDocument(doc: DocRow): Promise<Advance> {
  const db = store();

  // 이미 판정이 끝난 문서는 다시 Upstage 를 부르지 않는다. 지난번 삭제가 실패했으면 여기서 한 번 더 시도한다.
  if (doc.result) {
    if (doc.upstage_file_id && doc.upstage_file_id !== "delete_pending") {
      const ok = await deleteFile(doc.upstage_file_id);
      await db.update(doc.id, { upstage_file_id: ok ? null : "delete_pending" }).catch(() => {});
    }
    return { kind: "done", doc };
  }

  if (doc.pipeline_status === "uploading" || !doc.upstage_job_id) {
    if (doc.pipeline_status === "failed") return { kind: "failed", doc, error: "문서 처리 서비스에 연결하지 못했습니다" };
    return { kind: "waiting", doc };
  }

  let job;
  try {
    job = await fetchJob(doc.upstage_job_id);
  } catch (e) {
    console.error("[advance] fetchJob 실패", doc.id, e);
    return { kind: "retry", doc };
  }

  const status = typeof job.status === "string" ? job.status : "";
  if (PENDING.has(status)) {
    await db.update(doc.id, { pipeline_status: status });
    return { kind: "pending", doc: { ...doc, pipeline_status: status } };
  }
  if (!TERMINAL.has(status)) {
    // 알 수 없는 상태. 원본을 지우지 않고 실패로 굳힌다.
    console.error("[advance] 알 수 없는 job status", doc.id, status);
    const updated = await db.update(doc.id, { pipeline_status: "failed" });
    return { kind: "failed", doc: updated ?? doc, error: "문서 처리 결과를 해석하지 못했습니다" };
  }

  // failed 는 종결 상태다. 같은 job_id 재조회로는 안 되므로 결과를 그대로 굳힌다.
  const result = verify(job);
  const phrases = buildPhrases(result);
  const updated = await db.update(doc.id, {
    pipeline_status: status,
    action_type: result.actionType ?? null,
    verdict: result.verdict,
    result,
    phrases,
  });
  // 원본 사진은 판독이 끝나면 지운다. 실패하면 표시해 두고 다음 조회에서 다시 시도한다.
  if (doc.upstage_file_id) {
    const ok = await deleteFile(doc.upstage_file_id);
    await db.update(doc.id, { upstage_file_id: ok ? null : doc.upstage_file_id }).catch(() => {});
  }
  return { kind: "done", doc: updated ?? { ...doc, pipeline_status: status, result, phrases, verdict: result.verdict } };
}

/** 아직 판정이 없는 최근 문서들을 진행시킨다. 워커가 몇 초마다 부른다. 한 번에 몇 건만 — Upstage 조회는 건당 1회. */
export async function sweepPending(opts: { limit?: number; maxAgeMs?: number } = {}): Promise<{ scanned: number; advanced: string[]; pending: string[] }> {
  const limit = opts.limit ?? 3;
  const maxAge = opts.maxAgeMs ?? 30 * 60_000;
  const now = Date.now();
  const rows = await store().recent(30);
  const targets = rows
    .filter((d) => !d.result && d.upstage_job_id && d.pipeline_status !== "failed")
    .filter((d) => now - new Date(d.created_at).getTime() < maxAge)
    .slice(0, limit);
  const advanced: string[] = [];
  const pending: string[] = [];
  for (const d of targets) {
    const r = await advanceDocument(d);
    if (r.kind === "done" || r.kind === "failed") advanced.push(d.id);
    else pending.push(d.id);
  }
  return { scanned: targets.length, advanced, pending };
}
