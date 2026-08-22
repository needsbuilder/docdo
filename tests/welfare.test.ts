import { describe, it, expect } from "vitest";
import { findRelatedBenefits, WELFARE_COVERAGE } from "@/lib/welfare";
import type { VerifyResult } from "@/lib/types";

const nhisBill: VerifyResult = {
  verdict: "clear",
  actionType: "pay",
  checks: [],
  reasons: [],
  fields: { issuer: "국민건강보험공단", doc_title: "건강보험료 납입고지서" },
};

describe("findRelatedBenefits", () => {
  it("건강보험료 고지서에서 기초연금과 보험료 경감을 찾는다", () => {
    const b = findRelatedBenefits(nhisBill).map((x) => x.id);
    expect(b).toContain("basic_pension");
    expect(b).toContain("nhis_elderly_reduction");
  });

  it("전기요금에서 에너지바우처를 찾는다", () => {
    const b = findRelatedBenefits({
      ...nhisBill,
      fields: { issuer: "한국전력공사", doc_title: "전기요금 청구서" },
    });
    expect(b.map((x) => x.id)).toContain("energy_voucher");
  });

  it("미등록 기관이면 아무것도 추천하지 않는다", () => {
    expect(
      findRelatedBenefits({
        ...nhisBill,
        fields: { issuer: "주식회사 케이티", doc_title: "통신요금" },
      }),
    ).toHaveLength(0);
  });

  it("광고 문서에는 추천하지 않는다", () => {
    expect(
      findRelatedBenefits({ verdict: "no_extract", actionType: "ad", checks: [], reasons: [] }),
    ).toHaveLength(0);
  });

  it("모든 항목에 출처와 확인일이 있다", () => {
    for (const b of findRelatedBenefits(nhisBill)) {
      expect(b.sourceUrl).toMatch(/^https:\/\//);
      expect(b.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  // ── 정직성 ──────────────────────────────────────────────

  it("판정을 믿을 수 없는 문서에는 추천하지 않는다", () => {
    for (const verdict of ["mismatch", "unknown_issuer", "needs_human", "failed"] as const) {
      expect(findRelatedBenefits({ ...nhisBill, verdict })).toHaveLength(0);
    }
  });

  it("기관명이 하위 조직 표기뿐이면 추천하지 않는다", () => {
    // '국민건강보험공단가짜환급센터' 는 구조만 맞는 이름이라 clear 로 올리지 않는다.
    // 그 문서에서 제도를 권하면 사칭본이 신뢰의 통로가 된다.
    expect(
      findRelatedBenefits({
        ...nhisBill,
        verdict: "review",
        fields: { issuer: "국민건강보험공단가짜환급센터" },
      }),
    ).toHaveLength(0);
  });

  it("자격을 단정하는 표현이 데이터에 없다", () => {
    for (const b of findRelatedBenefits(nhisBill)) {
      const all = `${b.name} ${b.target} ${b.howTo}`;
      expect(all).not.toMatch(/받으실 수 있습니다|받을 수 있습니다|대상입니다$|자격이 있습니다/);
    }
  });

  it("연락처는 숫자와 하이픈뿐이다 (문서에서 읽은 값이 섞이지 않는다)", () => {
    for (const b of findRelatedBenefits(nhisBill)) {
      expect(b.contact).toMatch(/^[0-9-]+$/);
    }
  });

  it("범위 고지 문구가 있다", () => {
    expect(WELFARE_COVERAGE).toMatch(/전체 복지서비스 목록이 아닙니다/);
  });

  it("fields 가 없으면 빈 배열", () => {
    expect(findRelatedBenefits({ verdict: "clear", checks: [], reasons: [] })).toHaveLength(0);
  });
});
