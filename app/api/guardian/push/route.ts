import { NextResponse } from "next/server";
import { getSession, NO_STORE } from "@/lib/auth";
import { store, type PushSub } from "@/lib/store";
import { pushConfigured, pushPublicKey } from "@/lib/push";

export const runtime = "nodejs";

const MAX_SUBS = 8;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function validSub(v: unknown): v is PushSub {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  const keys = s.keys as Record<string, unknown> | undefined;
  return (
    typeof s.endpoint === "string" &&
    /^https:\/\//.test(s.endpoint) &&
    s.endpoint.length < 2048 &&
    !!keys &&
    typeof keys.p256dh === "string" &&
    typeof keys.auth === "string"
  );
}

/** 공개키와 설정 여부. 보호자 세션이 있어야 한다. */
export async function GET(req: Request) {
  const s = getSession(req);
  if (!s) return json({ error: "없음" }, 404);
  const g = await store().guardianById(s.guardianId).catch(() => null);
  return json({ configured: pushConfigured(), publicKey: pushPublicKey(), count: g?.push_subscriptions?.length ?? 0 });
}

/** 이 기기의 구독을 저장한다. endpoint 로 중복을 막는다. */
export async function POST(req: Request) {
  const s = getSession(req);
  if (!s) return json({ error: "없음" }, 404);
  const body = (await req.json().catch(() => null)) as { subscription?: unknown } | null;
  if (!validSub(body?.subscription)) return json({ error: "구독 정보가 올바르지 않습니다" }, 400);
  const sub = body!.subscription as PushSub;
  const g = await store().guardianById(s.guardianId);
  if (!g) return json({ error: "없음" }, 404);
  const rest = (g.push_subscriptions ?? []).filter((x) => x.endpoint !== sub.endpoint);
  const next = [...rest, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }].slice(-MAX_SUBS);
  await store().setPushSubscriptions(g.id, next);
  return json({ ok: true, count: next.length });
}

export async function DELETE(req: Request) {
  const s = getSession(req);
  if (!s) return json({ error: "없음" }, 404);
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const g = await store().guardianById(s.guardianId);
  if (!g) return json({ error: "없음" }, 404);
  const next = (g.push_subscriptions ?? []).filter((x) => x.endpoint !== endpoint);
  await store().setPushSubscriptions(g.id, next);
  return json({ ok: true, count: next.length });
}
