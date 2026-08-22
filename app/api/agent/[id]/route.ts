import { NextResponse } from "next/server";
import { store, type TraceStep, type ActionResult } from "@/lib/store";
import { agentAuthorized } from "@/lib/agentAuth";
import { NO_STORE } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_STEPS = 24;
const MAX_SHOT = 120_000; // data URL 길이. 화면당 640px JPEG 한 장 정도.
const MAX_LIVE = 90_000;
const FINAL = new Set(["done", "blocked", "failed"]);

/** 워커가 단계를 기록하거나 끝을 알린다. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!agentAuthorized(req)) return NextResponse.json({ error: "없음" }, { status: 404, headers: NO_STORE });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { step?: TraceStep; status?: string; result?: ActionResult; live?: string } | null;
  if (!body) return NextResponse.json({ error: "JSON 형식이 아닙니다" }, { status: 400, headers: NO_STORE });

  const db = store();
  const doc = await db.get(id);
  if (!doc || doc.action_status !== "running") return NextResponse.json({ error: "실행 중인 문서가 아닙니다" }, { status: 409, headers: NO_STORE });

  // 실시간 화면만 올리는 경우 — 트레이스는 건드리지 않는다. 가장 잦은 호출이라 가볍게.
  if (body.live !== undefined && !body.step && !body.status) {
    const live = typeof body.live === "string" && body.live.length <= MAX_LIVE ? body.live : null;
    await db.update(id, { action_live: live });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  const trace = [...(doc.action_trace ?? [])];
  if (body.step && typeof body.step.title === "string") {
    const shot = typeof body.step.shot === "string" && body.step.shot.length <= MAX_SHOT ? body.step.shot : undefined;
    trace.push({ t: new Date().toISOString(), title: body.step.title.slice(0, 120), detail: body.step.detail?.slice(0, 400), shot });
    if (trace.length > MAX_STEPS) trace.splice(0, trace.length - MAX_STEPS);
  }
  const patch: Parameters<typeof db.update>[1] = { action_trace: trace };
  if (body.status && FINAL.has(body.status)) {
    patch.action_status = body.status;
    patch.action_result = body.result ?? null;
    patch.action_live = null;
    if (body.status === "done") {
      patch.resolution_status = "done";
      patch.done_at = new Date().toISOString();
    }
  }
  const data = await db.update(id, patch);
  return NextResponse.json({ ok: true, action_status: data?.action_status }, { headers: NO_STORE });
}
