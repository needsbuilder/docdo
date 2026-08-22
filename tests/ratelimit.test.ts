import { describe, it, expect, beforeEach } from "vitest";
import { clientKey, takeToken, resetRateLimit, RATE_LIMIT } from "@/lib/ratelimit";

beforeEach(() => resetRateLimit());

describe("takeToken", () => {
  it("창 안에서 상한까지만 허용한다", () => {
    for (let i = 0; i < RATE_LIMIT.MAX_PER_WINDOW; i++) {
      expect(takeToken("a", 1000).ok).toBe(true);
    }
    const denied = takeToken("a", 1000);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.retryAfterSec).toBeGreaterThan(0);
  });

  it("창이 지나면 다시 허용한다", () => {
    for (let i = 0; i < RATE_LIMIT.MAX_PER_WINDOW; i++) takeToken("a", 1000);
    expect(takeToken("a", 1000 + RATE_LIMIT.WINDOW_MS + 1).ok).toBe(true);
  });

  it("키가 다르면 서로 영향을 주지 않는다", () => {
    for (let i = 0; i < RATE_LIMIT.MAX_PER_WINDOW; i++) takeToken("a", 1000);
    expect(takeToken("b", 1000).ok).toBe(true);
  });

  it("키가 무한히 쌓이지 않는다", () => {
    for (let i = 0; i < 6000; i++) takeToken(`k${i}`, 1000);
    // 창이 지난 뒤 새 키를 넣으면 정리가 돈다
    expect(takeToken("after", 1000 + RATE_LIMIT.WINDOW_MS + 1).ok).toBe(true);
  });
});

describe("clientKey", () => {
  it("x-forwarded-for 의 첫 주소를 쓴다", () => {
    const req = new Request("https://x/", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(clientKey(req)).toBe("203.0.113.9");
  });

  it("헤더가 없으면 unknown", () => {
    expect(clientKey(new Request("https://x/"))).toBe("unknown");
  });
});
