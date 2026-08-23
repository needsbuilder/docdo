import { NextResponse } from "next/server";
import { notifyHousehold } from "@/lib/push";
import { store, type TraceStep, type ActionResult, type ActionWait, type AgentInput } from "@/lib/store";
import { agentAuthorized } from "@/lib/agentAuth";
import { NO_STORE } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_STEPS = 24;
const MAX_SHOT = 120_000; // data URL 길이. 화면당 640px JPEG 한 장 정도.
const MAX_LIVE = 90_000;
const FINAL = new Set(["done", "blocked", "failed"]);
const ACTIVE = new Set(["running", "waiting"]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

type Body = {
  /** 워커가 claim 때 받은 실행 리스. 문서의 현재 값과 다르면 거부(옛 워커). */
  run?: string;
  step?: TraceStep;
  status?: string;
  result?: ActionResult;
  live?: string;
  /** waiting 으로 들어간다. 이유와 안내를 적는다. */
  wait?: ActionWait;
  /** 워커가 소비한 입력 id 들. 큐에서 지운다. */
  consumed?: string[];
};

/** 워커 전용. 단계 기록 · 실시간 화면 · 대기 진입 · 입력 소비 · 종료. 응답에 남은 입력 큐를 실어 준다. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!agentAuthorized(req)) return json({ error: "없음" }, 404);
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return json({ error: "JSON 형식이 아닙니다" }, 400);

  const db = store();
  const doc = await db.get(id);
  if (!doc || !ACTIVE.has(doc.action_status)) return json({ error: "실행 중인 문서가 아닙니다" }, 409);
  if (!body.run || body.run !== doc.action_run) return json({ error: "이 실행은 더 이상 유효하지 않습니다" }, 409);

  const patch: Parameters<typeof db.update>[1] = {};
  let inputs = doc.action_inputs ?? [];

  if (body.consumed?.length) {
    const gone = new Set(body.consumed);
    inputs = inputs.filter((i) => !gone.has(i.id));
    patch.action_inputs = inputs;
  }
  if (body.live !== undefined) {
    patch.action_live = typeof body.live === "string" && body.live.length <= MAX_LIVE ? body.live : null;
  }
  if (body.step && typeof body.step.title === "string") {
    const trace = [...(doc.action_trace ?? [])];
    const shot = typeof body.step.shot === "string" && body.step.shot.length <= MAX_SHOT ? body.step.shot : undefined;
    trace.push({ t: new Date().toISOString(), title: body.step.title.slice(0, 120), detail: body.step.detail?.slice(0, 400), shot });
    if (trace.length > MAX_STEPS) trace.splice(0, trace.length - MAX_STEPS);
    patch.action_trace = trace;
  }
  if (body.wait) {
    patch.action_status = "waiting";
    patch.action_wait = { reason: String(body.wait.reason).slice(0, 200), hint: String(body.wait.hint).slice(0, 400), mode: body.wait.mode === "confirm" ? "confirm" : "remote" };
  }
  if (body.status === "running" && doc.action_status === "waiting") {
    patch.action_status = "running";
    patch.action_wait = null;
  }
  if (body.status && FINAL.has(body.status)) {
    patch.action_status = body.status;
    patch.action_result = body.result ?? null;
    patch.action_live = null;
    patch.action_wait = null;
    patch.action_inputs = [];
    if (body.status === "done") {
      patch.resolution_status = "done";
      patch.done_at = new Date().toISOString();
    }
  }
  const data = Object.keys(patch).length ? await db.update(id, patch) : doc;

  // 보호자 푸시 — 상태가 바뀐 순간에만. 실패해도 워커 흐름을 막지 않는다.
  const label = doc.phrases?.docLabel ?? "우편물";
  if (patch.action_status === "waiting" && doc.action_status !== "waiting") {
    await notifyHousehold(doc.household_id, { title: "보호자 차례예요", body: `${label} · ${patch.action_wait?.reason ?? "직접 확인이 필요해요"}`, url: "/guardian", tag: `agent-${id}` }).catch(() => {});
  } else if (body.status === "done" && doc.action_status !== "done") {
    await notifyHousehold(doc.household_id, { title: "처리됐어요", body: body.result?.summary ?? `${label} 처리 완료`, url: "/guardian", tag: `agent-${id}` }).catch(() => {});
  } else if ((body.status === "blocked" || body.status === "failed") && !FINAL.has(doc.action_status)) {
    await notifyHousehold(doc.household_id, { title: "독도가 멈췄어요", body: body.result?.summary ?? `${label} · 확인이 필요해요`, url: "/guardian", tag: `agent-${id}` }).catch(() => {});
  }
  return json({ ok: true, action_status: data?.action_status, inputs: (data?.action_inputs ?? []) as AgentInput[] });
}
