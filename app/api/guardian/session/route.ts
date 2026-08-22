import { NextResponse } from "next/server";
import { authConfigured, checkPassphrase, clearCookie, isGuardian, sessionCookie, NO_STORE } from "@/lib/auth";
import { clientKey, takeToken } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** 자녀 로그인. 공유 암구호 하나다 — 데모 규모. */
export async function POST(req: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "서버에 암구호가 설정되지 않았습니다" }, { status: 503, headers: NO_STORE });
  }
  // 무차별 대입은 업로드와 같은 버킷으로 막는다.
  const gate = takeToken(`login:${clientKey(req)}`);
  if (!gate.ok) {
    return NextResponse.json({ error: "잠시 후 다시 시도해 주세요" }, {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": String(gate.retryAfterSec) },
    });
  }
  let passphrase: unknown;
  try {
    ({ passphrase } = await req.json());
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아닙니다" }, { status: 400, headers: NO_STORE });
  }
  if (!checkPassphrase(passphrase)) {
    return NextResponse.json({ error: "암구호가 맞지 않습니다" }, { status: 401, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true }, { headers: { ...NO_STORE, "Set-Cookie": sessionCookie() } });
}

export async function GET(req: Request) {
  return NextResponse.json({ authenticated: isGuardian(req), configured: authConfigured() }, { headers: NO_STORE });
}

export async function DELETE() {
  return NextResponse.json({ ok: true }, { headers: { ...NO_STORE, "Set-Cookie": clearCookie() } });
}
