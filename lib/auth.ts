import "server-only";
import crypto from "node:crypto";

// 자녀 화면은 부모님 우편물의 원문을 본다. 아무나 열면 안 된다.
//
// 데모 규모에 맞춘 최소 인증이다 — 공유 암구호 하나 + HttpOnly 쿠키.
// 실서비스에는 가구별 계정과 RLS 가 필요하다. README 에 명시한다.
//
// 어르신 업로드는 인증하지 않는다. 어르신에게 로그인을 시킬 수 없다.
// 대신 어르신이 받는 응답에서 원문 필드를 빼고(lib/dto.ts), 업로드는 속도 제한을 건다.

const COOKIE = "docdo_guardian";
const MAX_AGE_SEC = 12 * 60 * 60;
const PURPOSE = "guardian-session-v1";

function secret(): string | null {
  const s = process.env.GUARDIAN_PASSPHRASE;
  return s && s.length >= 6 ? s : null;
}

/** 암구호가 설정되지 않았으면 보호 자체가 없는 것이다. 그 사실을 호출자가 알아야 한다. */
export const authConfigured = () => secret() !== null;

function token(): string {
  const s = secret();
  if (!s) throw new Error("GUARDIAN_PASSPHRASE 없음");
  return crypto.createHmac("sha256", s).update(PURPOSE).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** 입력한 암구호가 맞는지. 길이가 달라도 시간이 새지 않게 비교한다. */
export function checkPassphrase(input: unknown): boolean {
  const s = secret();
  if (!s || typeof input !== "string") return false;
  const h = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
  return safeEqual(h(input), h(s));
}

export function sessionCookie(): string {
  return [
    `${COOKIE}=${token()}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${MAX_AGE_SEC}`,
  ].join("; ");
}

export function clearCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** 요청에 유효한 자녀 세션이 있는가. */
export function isGuardian(req: Request): boolean {
  if (!authConfigured()) return false;
  const raw = req.headers.get("cookie");
  if (!raw) return false;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== COOKIE) continue;
    try {
      return safeEqual(rest.join("="), token());
    } catch {
      return false;
    }
  }
  return false;
}

/** 문서 응답은 절대 캐시하지 않는다. 공유 CDN 에 남으면 그 자체가 유출이다. */
export const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie",
} as const;
