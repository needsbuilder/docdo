import { describe, it, expect } from "vitest";
import { koNumber, koMoney, koDate, koPhone, shortLabel, buildPhrases } from "@/lib/phrase";
import type { VerifyResult } from "@/lib/types";

describe("숫자 한글 변환", () => {
  it.each([
    [32000, "삼만 이천"],
    [73000, "칠만 삼천"],
    [1000, "천"],
    [10, "십"],
    [0, "영"],
    [120500, "십이만 오백"],
    [101764, "십만 천칠백육십사"],
    [38420, "삼만 팔천사백이십"],
  ])("%i → %s", (n, s) => {
    expect(koNumber(n as number)).toBe(s);
  });
  it.each([NaN, Infinity, -Infinity])("%s 는 빈 문자열", (n) => {
    expect(koNumber(n as number)).toBe("");
  });
  it("금액에 원을 붙인다", () => {
    expect(koMoney(32000)).toBe("삼만 이천 원");
  });
  it("날짜", () => {
    expect(koDate("2026-08-30")).toBe("팔월 삼십일");
  });
  it.each(["", "2026/08/30", "내일", null, undefined])("%s 는 빈 문자열", (d) => {
    expect(koDate(d as string)).toBe("");
  });
  it("전화번호는 자릿수로", () => {
    expect(koPhone("1577-1000")).toBe("일오칠칠 일공공공");
  });
});

describe("shortLabel", () => {
  it.each([
    ["2026년 7월분 건강보험료 납입고지서", "건강보험료"],
    ["2026년 7월분 전기요금 청구서", "전기요금"],
    ["지방세 체납 독촉장", "지방세"],
    ["기초연금 신청 안내", "기초연금"],
  ])("%s → %s", (t, l) => {
    expect(shortLabel(t)).toBe(l);
  });
  it.each([null, undefined, "", "   "])("%s 는 '우편물'", (t) => {
    expect(shortLabel(t)).toBe("우편물");
  });
});

describe("buildPhrases", () => {
  const base: VerifyResult = {
    verdict: "clear",
    actionType: "pay",
    checks: [],
    reasons: [],
    speechSuppressed: false,
    fields: {
      doc_title: "건강보험료 납입고지서",
      amount_krw: 32000,
      due_date: "2026-08-30",
      issuer: "국민건강보험공단",
    },
    fieldConfidence: { amount_krw: "high", due_date: "high", issuer: "high" },
  };

  it("정상이면 금액과 기한을 말하되 지시하지 않는다", () => {
    const p = buildPhrases(base);
    expect(p.docLabel).toBe("건강보험료");
    expect(p.screenLines).toContain("3만 2천원");
    expect(p.speech).toContain("삼만 이천 원");
    expect(p.speech).not.toMatch(/내시면 됩니다|내세요|납부하세요/);
  });

  it("낭독 억제면 숫자를 말하지 않는다", () => {
    const p = buildPhrases({ ...base, verdict: "review", speechSuppressed: true });
    expect(p.speech).not.toMatch(/[0-9]|삼만|이천/);
    expect(p.speech).toContain("정확히 읽지 못");
  });

  it("불일치면 경고를 먼저 말한다", () => {
    const p = buildPhrases({ ...base, verdict: "mismatch" });
    expect(p.speech.startsWith("어르신, 잠깐만요")).toBe(true);
    expect(p.speech).toContain("전화하지 마세요");
  });

  // ── 원칙 위반 회귀 ──────────────────────────────────────────

  it.each([
    "clear",
    "review",
    "mismatch",
    "unknown_issuer",
    "not_checkable",
    "no_extract",
    "needs_human",
    "failed",
  ] as const)("%s 판정에서 지시문을 만들지 않는다", (verdict) => {
    const p = buildPhrases({ ...base, verdict });
    // 원칙 3(지시 금지) · 원칙 4(폐기 지시 금지) · 원칙 1(금전 경로 금지)
    expect(p.speech).not.toMatch(/내시면|내세요|납부하|신청하세요|버리|폐기|계좌|송금|입금/);
    expect(p.screenLines.join(" ")).not.toMatch(/버리|폐기|계좌|송금|입금|납부하/);
  });

  it.each(["mismatch", "unknown_issuer", "needs_human", "no_extract", "failed"] as const)(
    "%s 판정에서는 숫자를 읽지 않는다",
    (verdict) => {
      const p = buildPhrases({ ...base, verdict });
      expect(p.speech).not.toMatch(/삼만|이천|팔월|삼십일/);
    },
  );

  it.each([
    "clear",
    "review",
    "mismatch",
    "unknown_issuer",
    "not_checkable",
    "no_extract",
    "needs_human",
    "failed",
  ] as const)("%s 판정에서도 화면에 빈 줄만 남지 않는다", (verdict) => {
    const p = buildPhrases({ ...base, verdict });
    expect(p.screenLines.length).toBeGreaterThan(0);
    expect(p.speech.length).toBeGreaterThan(0);
  });

  it("추출 결과가 없어도 '우편물 우편물' 같은 문구가 나오지 않는다", () => {
    const p = buildPhrases({ verdict: "no_extract", checks: [], reasons: [], speechSuppressed: false });
    expect(p.docLabel).toBe("우편물");
    expect(p.speech).not.toMatch(/우편물\s*우편물/);
  });

  it("review 는 확인이 필요하다는 사실을 전한다", () => {
    const p = buildPhrases({ ...base, verdict: "review" });
    expect(p.speech).toMatch(/확인/);
  });

  it("failed 는 처리하지 못했다고 말한다", () => {
    const p = buildPhrases({ ...base, verdict: "failed" });
    expect(p.speech).toMatch(/읽지 못|처리하지 못/);
  });

  // ── 값 형식 방어 ────────────────────────────────────────────

  it("금액이 문자열로 와도 읽는다", () => {
    const p = buildPhrases({ ...base, fields: { ...base.fields, amount_krw: "32,000" } });
    expect(p.screenLines).toContain("3만 2천원");
    expect(p.speech).toContain("삼만 이천 원");
  });

  it("금액이 숫자가 아니면 금액을 말하지 않는다", () => {
    const p = buildPhrases({ ...base, fields: { ...base.fields, amount_krw: "확인 요망" } });
    expect(p.speech).not.toMatch(/원/);
  });

  it("apply 문서는 신청 기한을 쓴다", () => {
    const p = buildPhrases({
      verdict: "clear",
      actionType: "apply",
      checks: [],
      reasons: [],
      speechSuppressed: false,
      fields: { doc_title: "기초연금 신청 안내", apply_deadline: "2026-09-15" },
      fieldConfidence: { apply_deadline: "high" },
    });
    expect(p.screenLines.join(" ")).toContain("9월 15일");
    expect(p.speech).toContain("구월 십오일");
  });

  it.each([
    [10000, "1만원"],
    [32000, "3만 2천원"],
    [120500, "12만 500원"],
    [5000, "5,000원"],
    [101764, "10만 1,764원"],
  ])("금액 %i 는 화면에 %s", (n, s) => {
    const p = buildPhrases({ ...base, fields: { ...base.fields, amount_krw: n } });
    expect(p.screenLines).toContain(s);
  });
});
