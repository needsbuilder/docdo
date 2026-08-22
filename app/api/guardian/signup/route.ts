import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import {
  authConfigured,
  hashPassword,
  newElderToken,
  sessionCookie,
  validEmail,
  validPassword,
  NO_STORE,
} from "@/lib/auth";
import { clientKey, takeToken } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** 보호자 가입. 가입하면 가구 하나와 어르신 초대 토큰이 생긴다. 바로 로그인 상태가 된다. */
export async function POST(req: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "서버에 AUTH_SECRET 이 설정되지 않았습니다" }, { status: 503, headers: NO_STORE });
  }
  const gate = takeToken(`signup:${clientKey(req)}`);
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
  if (!validEmail(email)) {
    return NextResponse.json({ error: "이메일 형식을 확인해 주세요" }, { status: 400, headers: NO_STORE });
  }
  if (!validPassword(body.password)) {
    return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다" }, { status: 400, headers: NO_STORE });
  }
  try {
    const g = await store().createGuardian({
      email,
      password_hash: hashPassword(body.password),
      elder_token: newElderToken(),
    });
    return NextResponse.json(
      { ok: true, elderToken: g.elder_token },
      { status: 201, headers: { ...NO_STORE, "Set-Cookie": sessionCookie({ guardianId: g.id, householdId: g.household_id }) } },
    );
  } catch (e) {
    if (e instanceof Error && e.message === "DUPLICATE_EMAIL") {
      return NextResponse.json({ error: "이미 가입된 이메일입니다" }, { status: 409, headers: NO_STORE });
    }
    console.error("[signup]", e);
    return NextResponse.json({ error: "가입하지 못했습니다" }, { status: 500, headers: NO_STORE });
  }
}
