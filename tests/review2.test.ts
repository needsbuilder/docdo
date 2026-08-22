import { describe, it, expect, vi, beforeEach } from "vitest";
import { phoneTokens, isPersonalMobile, verify } from "@/lib/verify";
import { buildPhrases } from "@/lib/phrase";
import { findRelatedBenefits } from "@/lib/welfare";
import { pollDocument, PollTimeout } from "@/lib/poll";
import { sniffImage } from "@/lib/sniff";
import { toElderDoc, toGuardianDoc } from "@/lib/dto";
import type { VerifyResult } from "@/lib/types";
import type { DocRow } from "@/lib/store";

// Codex 2차 리뷰(2026-08-23)가 실제 실행으로 재현한 결함을 고정한다.

const OK = {
  issuer: "국민건강보험공단",
  amount_krw: 73000,
  due_date: "2026-08-25",
  contact_phone: "1577-1000",
};

function job(fields: Record<string, unknown>) {
  const av = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, { _value: v, confidence: "high" }]),
  );
  return {
    status: "completed",
    output: [
      {
        model: "step_2_classify",
        status: "completed",
        content: [
          {
            text: "pay",
            additional_values: {
              document_type: { _value: "pay", confidence: "high", confidence_score: 0.99 },
            },
          },
        ],
      },
      {
        model: "Information Extract - Extract-1",
        status: "completed",
        content: [{ text: JSON.stringify(fields), additional_values: av }],
      },
    ],
  };
}

describe("#5 전화번호 — 공백·줄바꿈도 번호 사이 경계다", () => {
  it.each([
    "1577-1000 010-4821-7733",
    "1577-1000\n010-4821-7733",
    "1577-1000\t010-4821-7733",
    "1577-1000, 010-4821-7733",
    "1577-1000; 010-4821-7733",
    "1577-1000 / 010-4821-7733",
  ])("%j 는 두 토큰", (p) => {
    expect(phoneTokens(p)).toEqual(["15771000", "01048217733"]);
    expect(isPersonalMobile(p)).toBe(true);
    expect(verify(job({ ...OK, contact_phone: p })).verdict).toBe("mismatch");
  });

  it("'010' 세 자리는 휴대전화가 아니다", () => {
    expect(isPersonalMobile("010")).toBe(false);
  });

  it("하이픈·괄호로 이어진 번호는 한 토큰이다", () => {
    expect(phoneTokens("(054) 270-6230")).toEqual(["054", "2706230"]);
    expect(phoneTokens("054-270-6230")).toEqual(["0542706230"]);
  });
});

describe("#8 buildPhrases — fail-closed", () => {
  const base: VerifyResult = {
    verdict: "review",
    actionType: "pay",
    checks: [],
    reasons: [],
    fields: { doc_title: "건강보험료", amount_krw: 32000, due_date: "2026-08-30" },
    fieldConfidence: { amount_krw: "high", due_date: "high" },
  };

  it("speechSuppressed 가 없으면 억제다", () => {
    const p = buildPhrases({ ...base });
    expect(p.speech).not.toMatch(/삼만|이천|팔월/);
  });

  it("speechSuppressed=false 여도 해당 필드가 high 가 아니면 숫자를 읽지 않는다", () => {
    const p = buildPhrases({
      ...base,
      speechSuppressed: false,
      fieldConfidence: { amount_krw: "low", due_date: "high" },
    });
    expect(p.speech).not.toMatch(/삼만|이천/);
    expect(p.speech).toMatch(/팔월 삼십일/);
  });

  it("no_extract 는 '급하지 않다'고 말하지 않는다", () => {
    const p = buildPhrases({ verdict: "no_extract", actionType: "ad", checks: [], reasons: [] });
    expect(p.speech).not.toMatch(/급히|급하지/);
    expect(p.speech).toMatch(/확인하지 못했어요/);
  });

  it("due_date 가 빈 문자열이면 apply_deadline 을 쓴다", () => {
    const p = buildPhrases({
      ...base,
      verdict: "clear",
      speechSuppressed: false,
      fields: { doc_title: "기초연금 신청 안내", due_date: "", apply_deadline: "2026-09-15" },
      fieldConfidence: { apply_deadline: "high" },
    });
    expect(p.speech).toMatch(/구월 십오일/);
  });
});

describe("#9 복지 게이트 — clear + issuer high + 통과 검사 1건 이상", () => {
  const r: VerifyResult = {
    verdict: "clear",
    actionType: "pay",
    checks: [],
    reasons: [],
    checksPassed: 1,
    checksTotal: 1,
    fields: { issuer: "국민건강보험공단" },
    fieldConfidence: { issuer: "high" },
  };
  it("조건을 다 갖추면 권한다", () => {
    expect(findRelatedBenefits(r).length).toBeGreaterThan(0);
  });
  it.each(["review", "not_checkable", "mismatch"] as const)("%s 는 권하지 않는다", (verdict) => {
    expect(findRelatedBenefits({ ...r, verdict })).toHaveLength(0);
  });
  it("기관명 신뢰도가 low 면 권하지 않는다", () => {
    expect(findRelatedBenefits({ ...r, fieldConfidence: { issuer: "low" } })).toHaveLength(0);
  });
  it("통과한 검사가 없으면 권하지 않는다", () => {
    expect(findRelatedBenefits({ ...r, checksPassed: 0 })).toHaveLength(0);
  });
});

describe("#6 pollDocument — 하드 타임아웃", () => {
  it("fetch 가 영원히 매달려도 deadline 에 끊는다", async () => {
    const fetchImpl = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_, rej) => {
          init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
        }),
    );
    await expect(
      pollDocument("x", { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(PollTimeout);
  });

  it("intervalMs 가 NaN 이어도 기본값으로 돈다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "x", pipeline_status: "queued", result: null, phrases: null }),
    });
    await expect(
      pollDocument("x", { fetchImpl, intervalMs: NaN, timeoutMs: 40 }),
    ).rejects.toBeInstanceOf(PollTimeout);
    // 2.5초 간격이 적용됐으면 40ms 안에 1회뿐이다
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("503 은 재시도하고 result+phrases 둘 다 있어야 끝난다", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "x", pipeline_status: "completed", result: { verdict: "clear" }, phrases: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "x",
          pipeline_status: "completed",
          result: { verdict: "clear" },
          phrases: { docLabel: "a", screenLines: [], speech: "b" },
        }),
      });
    const r = await pollDocument("x", { fetchImpl, intervalMs: 1 });
    expect(r.phrases).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("#11 업로드 — 바이트를 본다", () => {
  it.each([
    ["JPEG", [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0], "image/jpeg"],
    ["PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0], "image/png"],
    ["WebP", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], "image/webp"],
  ])("%s 를 알아본다", (_n, bytes, mime) => {
    expect(sniffImage(new Uint8Array(bytes))?.mime).toBe(mime);
  });
  it.each([
    ["HTML", "<!doctype html><html>"],
    ["PDF", "%PDF-1.7 xxxxxxxxxx"],
    ["ZIP", "PK\x03\x04xxxxxxxxxxxx"],
    ["빈 값", ""],
  ])("%s 는 거부", (_n, s) => {
    expect(sniffImage(new TextEncoder().encode(s))).toBeNull();
  });
});

describe("#1 DTO — 어르신 응답에는 원문이 없다", () => {
  const row: DocRow = {
    id: "d1",
    household_id: "demo",
    created_at: "2026-08-23T00:00:00Z",
    pipeline_status: "completed",
    resolution_status: "new",
    upstage_job_id: "job_secret",
    upstage_file_id: "file_secret",
    action_type: "pay",
    verdict: "clear",
    result: {
      verdict: "clear",
      checks: [{ name: "문의전화", value: "1577-1000", ok: true, expected: ["1577-1000"], kind: "phone" }],
      reasons: [],
      fields: {
        doc_title: "110-555-123456 계좌로 즉시 송금",
        contact_phone: "010-4821-7733",
        info_url: "https://evil.example",
        summary: "오늘 입금하지 않으면 압류",
      },
      safeContact: { phones: ["1577-1000"], hosts: ["nhis.or.kr"], source: [], verifiedAt: "2026-08-22" },
    },
    phrases: { docLabel: "우편물", screenLines: ["a"], speech: "b" },
    reviewed_at: null,
    done_at: null,
    action_status: "none",
    action_trace: [],
    action_result: null,
    approved_at: null,
    action_live: null,
    action_wait: null,
    action_inputs: [],
  };

  it("어르신 응답에 fields·checks·upstage id 가 없다", () => {
    const s = JSON.stringify(toElderDoc(row));
    for (const leak of ["110-555", "010-4821", "evil.example", "압류", "job_secret", "file_secret", "fields", "doc_title"]) {
      expect(s).not.toContain(leak);
    }
  });

  it("어르신 응답에 문구·판정·공식 연락처는 있다", () => {
    const e = toElderDoc(row);
    expect(e.phrases?.speech).toBe("b");
    expect(e.result?.verdict).toBe("clear");
    expect(e.result?.safeContact?.phones).toEqual(["1577-1000"]);
  });

  it("자녀 응답에는 원문은 있고 upstage id 는 없다", () => {
    const g = toGuardianDoc(row) as Record<string, unknown>;
    expect(g.result).toBeTruthy();
    expect(g).not.toHaveProperty("upstage_job_id");
    expect(g).not.toHaveProperty("upstage_file_id");
  });
});

describe("auth — 계정·세션", () => {
  beforeEach(() => vi.resetModules());

  it("AUTH_SECRET 없으면 configured=false, 세션 없음", async () => {
    delete process.env.AUTH_SECRET;
    const { authConfigured, getSession } = await import("@/lib/auth");
    expect(authConfigured()).toBe(false);
    expect(getSession(new Request("https://x/"))).toBeNull();
  });

  it("비밀번호 해시는 검증되고 다른 비밀번호는 거부된다", async () => {
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    const { hashPassword, verifyPassword } = await import("@/lib/auth");
    const h = hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse battery", h)).toBe(true);
    expect(verifyPassword("correct horse batter", h)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
    expect(hashPassword("a")).not.toBe(hashPassword("a")); // salt
  });

  it("서명된 세션 쿠키만 통과하고 변조·만료는 거부된다", async () => {
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    const { sessionCookie, getSession } = await import("@/lib/auth");
    const cookie = sessionCookie({ guardianId: "g1", householdId: "h1" }).split(";")[0];
    const s = getSession(new Request("https://x/", { headers: { cookie } }));
    expect(s?.guardianId).toBe("g1");
    expect(s?.householdId).toBe("h1");
    // payload 변조
    const [name, value] = cookie.split("=");
    const [payload, sig] = value.split(".");
    const tampered = Buffer.from(JSON.stringify({ guardianId: "g1", householdId: "OTHER", exp: 9e9 })).toString("base64url");
    expect(getSession(new Request("https://x/", { headers: { cookie: `${name}=${tampered}.${sig}` } }))).toBeNull();
    // 다른 서명키
    process.env.AUTH_SECRET = "ffffffffffffffffffffffffffffffff";
    vi.resetModules();
    const m2 = await import("@/lib/auth");
    expect(m2.getSession(new Request("https://x/", { headers: { cookie: `${name}=${payload}.${sig}` } }))).toBeNull();
  });

  it("쿠키 속성: HttpOnly·Secure·SameSite", async () => {
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    const { sessionCookie } = await import("@/lib/auth");
    const c = sessionCookie({ guardianId: "g", householdId: "h" });
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Lax/);
  });

  it("어르신 토큰은 헤더 우선, 모양이 틀리면 무시", async () => {
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    const { readElderToken, newElderToken } = await import("@/lib/auth");
    const t = newElderToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(readElderToken(new Request("https://x/?h=short"))).toBeNull();
    expect(readElderToken(new Request(`https://x/?h=${t}`))).toBe(t);
    expect(readElderToken(new Request("https://x/", { headers: { "x-docdo-h": t } }))).toBe(t);
    expect(readElderToken(new Request("https://x/?h=../../etc"))).toBeNull();
  });

  it("이메일·비밀번호 형식", async () => {
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    const { validEmail, validPassword } = await import("@/lib/auth");
    expect(validEmail("a@b.co")).toBe(true);
    expect(validEmail("not an email")).toBe(false);
    expect(validPassword("1234567")).toBe(false);
    expect(validPassword("12345678")).toBe(true);
  });
});
