import { describe, it, expect } from "vitest";
import {
  verify,
  findIssuer,
  matchIssuer,
  normHost,
  phoneTokens,
  isPersonalMobile,
  isOfficialPayee,
  isValidDate,
  isValidAmount,
} from "@/lib/verify";
import { REGISTRY } from "@/lib/registry";
import { buildPhrases, shortLabel, koDate } from "@/lib/phrase";

// Codex 리뷰(2026-08-23)가 실제 실행으로 재현한 우회 경로를 고정한다.
// 이 구멍들은 전부 scripts/verify.py 원본에도 있었다 — 포팅 회귀가 아니라 설계 결함이었다.

const OK = {
  issuer: "국민건강보험공단",
  amount_krw: 73000,
  due_date: "2026-08-25",
  contact_phone: "1577-1000",
};

function job(
  fields: Record<string, unknown>,
  opts: { cls?: string; conf?: string; av?: Record<string, unknown> } = {},
) {
  const { cls = "pay", conf = "high", av } = opts;
  const values =
    av ??
    Object.fromEntries(
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
            text: cls,
            additional_values: {
              document_type: { _value: cls, confidence: conf, confidence_score: 0.99 },
            },
          },
        ],
      },
      {
        model: "Information Extract - Extract-1",
        status: "completed",
        content: [{ text: JSON.stringify(fields), additional_values: values }],
      },
    ],
  };
}

describe("#1 예금주 — 부분 문자열로 통과하지 못한다", () => {
  it.each([
    "홍길동국민건강보험공단",
    "국민건강보험공단사칭수납대행",
    "EVILNHIS",
    "(주)건보수납대행",
    "국민건강보험공단환급센터",
  ])("%s 는 mismatch", (payee) => {
    const r = verify(job({ ...OK, payee_name: payee }));
    expect(r.verdict).toBe("mismatch");
    expect(r.checks.find((c) => c.name === "가상계좌 예금주")?.ok).toBe(false);
  });

  it.each(["국민건강보험공단", "건강보험공단", " 국민건강보험공단 ", "(주) 국민건강보험공단"])(
    "%s 는 공식 예금주로 인정",
    (payee) => {
      const issuer = findIssuer("국민건강보험공단")!;
      expect(isOfficialPayee(payee, issuer)).toBe(true);
    },
  );
});

describe("#2 전화번호 — 여러 개면 각각 검사한다", () => {
  it("공식 번호 뒤에 개인 휴대전화를 붙여도 통과하지 못한다", () => {
    const r = verify(
      job({ ...OK, issuer: "포항시", contact_phone: "054-270-6230 / 010-4821-7733" }),
    );
    expect(r.verdict).toBe("mismatch");
  });

  it("국번만 적으면 부서 직통번호로 인정하지 않는다", () => {
    expect(verify(job({ ...OK, issuer: "포항시", contact_phone: "054-270" })).verdict).not.toBe(
      "clear",
    );
  });

  it("진짜 부서 직통번호는 인정한다", () => {
    expect(verify(job({ ...OK, issuer: "포항시", contact_phone: "054-270-6230" })).verdict).toBe(
      "clear",
    );
  });

  it("대표번호 뒤 덧붙임은 여전히 review", () => {
    expect(verify(job({ ...OK, contact_phone: "1577-1000-666" })).verdict).toBe("review");
  });

  it("번호를 토큰으로 쪼갠다", () => {
    expect(phoneTokens("054-270-6230 / 010-4821-7733")).toEqual(["0542706230", "01048217733"]);
  });

  it("이어 붙인 문자열에서도 휴대전화를 찾는다", () => {
    expect(isPersonalMobile("054-270-6230 / 010-4821-7733")).toBe(true);
  });
});

describe("#3 하위조직 꼬리 — 구조만 맞는 이름은 clear 로 올리지 않는다", () => {
  it.each(["국민건강보험공단가짜환급센터", "국민연금공단환급사기센터", "포항시사칭센터"])(
    "%s 는 clear 가 아니다",
    (issuer) => {
      const r = verify(job({ ...OK, issuer }));
      expect(r.verdict).not.toBe("clear");
      expect(r.verdict).toBe("review");
    },
  );

  it("정확 일치하는 기관명은 clear 로 갈 수 있다", () => {
    expect(matchIssuer("국민건강보험공단")?.match).toBe("exact");
    expect(verify(job(OK)).verdict).toBe("clear");
  });

  it("실제 지사 표기는 기관을 찾되 branch 로 표시한다", () => {
    const m = matchIssuer("국민연금공단 포항지사 복지지원팀");
    expect(m?.issuer.issuer_id).toBe("nps");
    expect(m?.match).toBe("branch");
  });
});

describe("#4 ReDoS — 반복 꼬리에 시간이 폭발하지 않는다", () => {
  it.each([16, 24, 40])("본부 x%i 를 50ms 안에 처리한다", (k) => {
    const t0 = performance.now();
    findIssuer("국민건강보험공단" + "본부".repeat(k) + "X");
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("아주 긴 기관명은 매칭 대상이 아니다", () => {
    expect(findIssuer("국민건강보험공단" + "가".repeat(200) + "센터")).toBeNull();
  });
});

describe("#5 분류·상태 계약 — fail-closed", () => {
  it("알 수 없는 문서 종류는 사람에게 보낸다", () => {
    expect(verify(job(OK, { cls: "pya" })).verdict).toBe("needs_human");
  });

  it("분류 신뢰도가 없으면 high 로 보지 않는다", () => {
    const j = job(OK);
    j.output[0].content[0].additional_values.document_type = { _value: "pay" } as never;
    expect(verify(j).verdict).toBe("needs_human");
  });

  it("분류 신뢰도가 범주 밖이면 사람에게 보낸다", () => {
    expect(verify(job(OK, { conf: "medium" })).verdict).toBe("needs_human");
  });

  it("분류 text 와 _value 가 다르면 사람에게 보낸다", () => {
    const j = job(OK);
    j.output[0].content[0].additional_values.document_type = {
      _value: "ad",
      confidence: "high",
    } as never;
    expect(verify(j).verdict).toBe("needs_human");
  });

  it.each(["", 0, false, "running"])("step status=%s 는 실패로 본다", (status) => {
    const j = job(OK);
    (j.output[1] as { status: unknown }).status = status;
    expect(verify(j).verdict).toBe("failed");
  });

  it.each(["pending", "", "COMPLETED"])("job status=%s 는 실패로 본다", (status) => {
    const j = job(OK);
    (j as { status: unknown }).status = status;
    expect(verify(j).verdict).toBe("failed");
  });

  it("분류 결과에 공백이 붙어도 필수 필드를 요구한다", () => {
    const r = verify(job({ issuer: OK.issuer, contact_phone: OK.contact_phone }, { cls: "pay " }));
    expect(r.verdict).not.toBe("clear");
  });

  it("같은 단계가 두 번 오면 실패로 본다", () => {
    const j = job(OK);
    j.output.push(j.output[1]);
    expect(verify(j).verdict).toBe("failed");
  });
});

describe("#6 text 와 _value 불일치 — _value 를 믿는다", () => {
  it("text 쪽 금액만 바꿔치기해도 _value 가 이긴다", () => {
    const j = job(OK);
    j.output[1].content[0].text = JSON.stringify({ ...OK, amount_krw: 999999 });
    const r = verify(j);
    expect(r.fields?.amount_krw).toBe(73000);
    expect(r.speechSuppressed).toBe(true);
    expect(r.verdict).toBe("review");
  });
});

describe("#7 어르신 화면에 원문을 띄우지 않는다", () => {
  it.each([
    "계좌110-555 송금",
    "2026년 환급 안내",
    "http://evil.com 접속 요망",
    "010-1234-5678 로 연락",
  ])("등록되지 않은 제목 '%s' 은 '우편물' 로만 나온다", (title) => {
    expect(shortLabel(title)).toBe("우편물");
    const p = buildPhrases({ ...verify(job({ ...OK, doc_title: title })) });
    expect(p.docLabel).toBe("우편물");
    expect(p.speech).not.toContain(title);
    expect(p.screenLines.join(" ")).not.toContain(title);
  });
});

describe("#8 날짜·금액 의미 검사", () => {
  it.each(["2026-99-99", "2026-02-30", "2026-13-01", "0001-01-01"])(
    "%s 는 날짜가 아니다",
    (d) => {
      expect(isValidDate(d)).toBe(false);
      expect(koDate(d)).toBe("");
    },
  );

  it("달력에 없는 기한은 결손으로 본다", () => {
    const r = verify(job({ ...OK, due_date: "2026-99-99" }));
    expect(r.verdict).toBe("review");
    expect(r.speechSuppressed).toBe(true);
    expect(buildPhrases(r).speech).not.toMatch(/구십구/);
  });

  it.each([false, 0, "확인 요망", -100, 1.5])("금액 %s 는 결손으로 본다", (amount_krw) => {
    const r = verify(job({ ...OK, amount_krw }));
    expect(r.verdict).toBe("review");
    expect(r.speechSuppressed).toBe(true);
  });

  it.each([73000, "73000", "73,000", "73,000원"])("금액 %s 는 유효하다", (v) => {
    expect(isValidAmount(v)).toBe(true);
  });
});

describe("#11 런타임 타입 — 예외를 던지지 않는다", () => {
  it.each([
    ["output 이 객체", { status: "completed", output: {} }, "failed"],
    ["output 항목이 문자열", { status: "completed", output: ["x"] }, "failed"],
    ["info_url 이 객체", job({ ...OK, info_url: { host: "nhis.or.kr" } }), "review"],
    ["issuer 가 배열", job({ ...OK, issuer: ["국민건강보험공단"] }), "unknown_issuer"],
    ["payee_name 이 숫자", job({ ...OK, payee_name: 12345 }), "mismatch"],
  ])("%s → %s", (_n, j, exp) => {
    expect(() => verify(j)).not.toThrow();
    expect(verify(j).verdict).toBe(exp);
  });

  it("값이 있는데 읽을 수 없으면 '문서에 없음'이라고 말하지 않는다", () => {
    const r = verify(job({ ...OK, info_url: { host: "nhis.or.kr" } }));
    expect(r.speechSuppressed).toBe(true);
    expect(r.reasons.some((x) => x.detail.includes("info_url"))).toBe(true);
  });

  it("contact_phone 이 숫자여도 번호로 읽는다", () => {
    expect(verify(job({ ...OK, contact_phone: 15771000 })).verdict).toBe("clear");
  });
});

describe("#12 레지스트리 오염 방지", () => {
  it("safeContact 배열을 밀어 넣어도 판정이 바뀌지 않는다", () => {
    const a = verify(job(OK));
    a.safeContact!.phones.push("02-9999-9999");
    expect(verify(job({ ...OK, contact_phone: "02-9999-9999" })).verdict).not.toBe("clear");
  });

  it("레지스트리는 얼려져 있다", () => {
    expect(Object.isFrozen(REGISTRY.issuers)).toBe(true);
    expect(Object.isFrozen(REGISTRY.issuers[0].official_phones)).toBe(true);
  });
});

describe("#9 mismatch 사유를 정확히 말한다", () => {
  it("예금주 불일치면 예금주라고 말한다", () => {
    const p = buildPhrases(verify(job({ ...OK, payee_name: "(주)건보수납대행" })));
    expect(p.speech).toContain("예금주");
    expect(p.speech).not.toContain("연락처가 공식 정보와");
  });

  it("개인 휴대전화면 상담 번호라고 말한다", () => {
    const p = buildPhrases(verify(job({ ...OK, contact_phone: "010-4821-7733" })));
    expect(p.speech).toContain("상담 번호");
  });
});

describe("normHost — 남은 우회 경로", () => {
  it.each(["//nhis.or.kr/x", "https://@nhis.or.kr/", "https://:@nhis.or.kr/"])(
    "%s 는 빈 값",
    (u) => {
      expect(normHost(u)).toBe("");
    },
  );
  it("후행 점은 같은 도메인으로 본다", () => {
    expect(normHost("https://nhis.or.kr./")).toBe("nhis.or.kr");
    expect(verify(job({ ...OK, info_url: "https://nhis.or.kr./x" })).verdict).toBe("clear");
  });
});

describe("불변식", () => {
  it("high 신뢰도 개인 휴대전화가 있으면 절대 clear 가 아니다", () => {
    for (const issuer of ["국민건강보험공단", "포항시", "가짜기관이름", "한국전력공사"]) {
      const r = verify(job({ ...OK, issuer, contact_phone: "010-1234-5678" }));
      expect(r.verdict).not.toBe("clear");
    }
  });

  it("clear 이면 필수 필드가 모두 유효하고 신뢰도가 high 다", () => {
    const r = verify(job(OK));
    expect(r.verdict).toBe("clear");
    for (const k of ["issuer", "amount_krw", "due_date"]) {
      expect(r.fieldConfidence?.[k]).toBe("high");
    }
    expect(r.speechSuppressed).toBe(false);
  });

  it("어르신 음성의 숫자는 high 필드에서만 나온다", () => {
    const j = job(OK);
    (j.output[1].content[0].additional_values as Record<string, { confidence: string }>).due_date.confidence =
      "low";
    const p = buildPhrases(verify(j));
    expect(p.speech).not.toMatch(/[0-9]|팔월|이십오일|칠만/);
  });
});
