import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import {
  authConfigured,
  clearCookie,
  getSession,
  sessionCookie,
  validEmail,
  verifyPassword,
  NO_STORE,
} from "@/lib/auth";
import { clientKey, takeToken } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** 로그인. */
export async function POST(req: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "서버에 AUTH_SECRET 이 설정되지 않았습니다" }, { status: 503, headers: NO_STORE });
  }
  // 무차별 대입은 업로드와 같은 버킷으로 막는다.
  const gate = takeToken(`login:${clientKey(req)}`);
  if (!gate.ok) {
    return NextResponse.json({ error: "잠시 후 다시 시도해 주세요" }, {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": String(gate.retryAfterSec) },
    });
  }
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아닙니다" }, { status: 400, headers: NO_STORE });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  // 이메일 존재 여부를 응답으로 구분하지 않는다.
  const fail = () =>
    NextResponse.json({ error: "이메일 또는 비밀번호가 맞지 않습니다" }, { status: 401, headers: NO_STORE });
  if (!validEmail(email) || !password) return fail();
  const g = await store().guardianByEmail(email);
  if (!g || !verifyPassword(password, g.password_hash)) return fail();
  return NextResponse.json(
    { ok: true },
    { headers: { ...NO_STORE, "Set-Cookie": sessionCookie({ guardianId: g.id, householdId: g.household_id }) } },
  );
}

/** 내 세션. 로그인돼 있으면 어르신 초대 토큰도 준다(보호자만 본다). */
export async function GET(req: Request) {
  const s = getSession(req);
  if (!s) {
    return NextResponse.json({ authenticated: false, configured: authConfigured() }, { headers: NO_STORE });
  }
  const g = await store().guardianById(s.guardianId);
  if (!g) {
    return NextResponse.json({ authenticated: false, configured: true }, {
      headers: { ...NO_STORE, "Set-Cookie": clearCookie() },
    });
  }
  return NextResponse.json(
    { authenticated: true, configured: true, email: g.email, elderToken: g.elder_token },
    { headers: NO_STORE },
  );
}

export async function DELETE() {
  return NextResponse.json({ ok: true }, { headers: { ...NO_STORE, "Set-Cookie": clearCookie() } });
}
