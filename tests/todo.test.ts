import { describe, it, expect } from "vitest";
import { buildTodos, daysLeft, parseISODate, ddayLabel } from "@/lib/todo";
import type { VerifyResult } from "@/lib/types";

const today = new Date(2026, 7, 23); // 2026-08-23 local
const base = (o: Partial<VerifyResult>): VerifyResult => ({ verdict: "clear", checks: [], reasons: [], ...o });

describe("todo", () => {
  it("날짜 파싱·D-day", () => {
    expect(parseISODate("2026-08-25")?.toISOString().slice(0, 10)).toBe("2026-08-25");
    expect(parseISODate("2026.08.25")?.toISOString().slice(0, 10)).toBe("2026-08-25");
    expect(parseISODate("")).toBeNull();
    expect(daysLeft(parseISODate("2026-08-25")!, today)).toBe(2);
    expect(ddayLabel(0)).toBe("오늘까지");
    expect(ddayLabel(-1)).toBe("1일 지남");
  });

  it("clear + 기한·금액 high → 납부 확인 1건", () => {
    const t = buildTodos(
      base({ fields: { due_date: "2026-08-25", amount_krw: 73000 }, fieldConfidence: { due_date: "high", amount_krw: "high" } }),
      today,
    );
    expect(t).toHaveLength(1);
    expect(t[0].text).toContain("8월 25일까지 납부됐는지 확인 (D-2)");
    expect(t[0].tone).toBe("warn");
  });

  it("low 신뢰도 날짜는 쓰지 않는다 (원칙 2)", () => {
    const t = buildTodos(base({ fields: { due_date: "2026-08-25" }, fieldConfidence: { due_date: "low" } }), today);
    expect(t.some((x) => x.text.includes("8월 25일"))).toBe(false);
  });

  it("mismatch → 경고 2건, 공식 번호만", () => {
    const t = buildTodos(
      base({ verdict: "mismatch", safeContact: { phones: ["1577-1000"], hosts: [], source: [], verifiedAt: "" } }),
      today,
    );
    expect(t.map((x) => x.tone)).toEqual(["danger", "danger"]);
    expect(t[1].text).toContain("1577-1000");
  });

  it("review → 기한 + 공식 번호 확인", () => {
    const t = buildTodos(
      base({
        verdict: "review",
        fields: { apply_deadline: "2026-09-30" },
        fieldConfidence: { apply_deadline: "high" },
        safeContact: { phones: ["1355"], hosts: [], source: [], verifiedAt: "" },
      }),
      today,
    );
    expect(t[0].text).toContain("9월 30일까지 신청 여부 결정");
    expect(t[1].text).toContain("1355");
  });
});
