import "server-only";
import crypto from "node:crypto";

// 보호자 계정과 세션.
//
// 보호자는 이메일+비밀번호로 가입한다. 비밀번호는 scrypt 로 해시한다.
// 세션은 HMAC 서명 쿠키 하나다 — 서버에 세션 테이블을 두지 않는다(데모 규모).
// 어르신은 계정이 없다. 보호자가 준 초대 링크의 토큰이 어르신의 신원이다.
//
// 없는 것(데모 범위 밖): 이메일 인증, 비밀번호 재설정, 다중 기기 로그아웃.

const COOKIE = "docdo_session";
const SESSION_SEC = 14 * 24 * 60 * 60;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;
const MIN_PASSWORD = 8;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET 없음 (16자 이상)");
  return s;
}

export const authConfigured = () => {
  const s = process.env.AUTH_SECRET;
  return !!s && s.length >= 16;
};

// ── 비밀번호 ─────────────────────────────────────────────────

export function validEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function validPassword(v: unknown): v is string {
  return typeof v === "string" && v.length >= MIN_PASSWORD && v.length <= 200;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, SCRYPT);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** 어르신 초대 토큰. URL 에 실리므로 URL-safe, 32바이트 난수. */
export function newElderToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// ── 세션 쿠키 ────────────────────────────────────────────────

export type Session = { guardianId: string; householdId: string; exp: number };

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function sessionCookie(s: Omit<Session, "exp">): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SEC;
  const payload = Buffer.from(JSON.stringify({ ...s, exp })).toString("base64url");
  const value = `${payload}.${sign(payload)}`;
  return [
    `${COOKIE}=${value}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_SEC}`,
  ].join("; ");
}

export function clearCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** 요청에 유효한 보호자 세션이 있으면 돌려준다. 서명·만료를 본다. */
export function getSession(req: Request): Session | null {
  if (!authConfigured()) return null;
  const v = readCookie(req, COOKIE);
  if (!v) return null;
  const dot = v.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = v.slice(0, dot);
  const sig = v.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (typeof s.guardianId !== "string" || typeof s.householdId !== "string") return null;
    if (typeof s.exp !== "number" || s.exp < Date.now() / 1000) return null;
    return s;
  } catch {
    return null;
  }
}

/** 어르신 요청의 초대 토큰. 헤더 우선, 없으면 쿼리. */
export function readElderToken(req: Request): string | null {
  const h = req.headers.get("x-docdo-h");
  if (h && /^[A-Za-z0-9_-]{20,64}$/.test(h)) return h;
  const u = new URL(req.url);
  const q = u.searchParams.get("h");
  if (q && /^[A-Za-z0-9_-]{20,64}$/.test(q)) return q;
  return null;
}

/** 문서 응답은 절대 캐시하지 않는다. 공유 CDN 에 남으면 그 자체가 유출이다. */
export const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
} as const;
