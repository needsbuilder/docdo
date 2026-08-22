import "server-only";

// 업로드 API 는 공개돼 있고 호출 1건이 Upstage 크레딧 약 $0.04 다.
// 인증을 붙일 시간이 없으므로 최소한 무한 반복은 막는다.
//
// ⚠ 한계: 서버리스 인스턴스마다 메모리가 따로다. 분산 공격은 막지 못한다.
//   전역 상한은 저장소 기준으로 따로 센다(느리지만 인스턴스를 가로지른다).

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;
const MAX_KEYS = 5_000;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** 프록시 뒤에서 클라이언트 IP 를 찾는다. 없으면 하나로 묶어 센다. */
export function clientKey(req: Request): string {
  const h = req.headers;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? h.get("x-vercel-forwarded-for") ?? "unknown";
}

export type RateResult = { ok: true } | { ok: false; retryAfterSec: number };

export function takeToken(key: string, now = Date.now()): RateResult {
  // 오래된 키를 정리한다. Map 이 무한히 자라면 그 자체가 취약점이다.
  if (buckets.size > MAX_KEYS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_KEYS) buckets.clear();
  }

  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }
  if (b.count >= MAX_PER_WINDOW) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count++;
  return { ok: true };
}

/** 시험용. 상태를 비운다. */
export function resetRateLimit(): void {
  buckets.clear();
}

export const RATE_LIMIT = { WINDOW_MS, MAX_PER_WINDOW } as const;
