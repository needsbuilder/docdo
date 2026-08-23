import { describe, it, expect } from "vitest";
import { verify, findIssuer, normHost, normPhone } from "@/lib/verify";

// scripts/security_test.py 의 공격·결손 입력 19종을 그대로 옮긴다.
// Python 원본(scripts/verify.py)과 같은 판정이 나와야 회귀가 잡힌다.

const OK = {
  issuer: "국민건강보험공단",
  amount_krw: 73000,
  due_date: "2026-08-25",
  contact_phone: "1577-1000",
};

type JobOpts = {
  status?: string;
  cls?: string;
  conf?: string;
  score?: number;
  fields?: Record<string, unknown>;
  steps?: string[];
};

function job(opts: JobOpts = {}) {
  const {
    status = "completed",
    cls = "pay",
    conf = "high",
    score = 0.99,
    fields = OK,
    steps = ["parse", "classify", "extract"],
  } = opts;
  const output: unknown[] = [];
  if (steps.includes("parse")) {
    output.push({
      model: "step_1_parse",
      status: "completed",
      content: [{ text: "{}", additional_values: {} }],
    });
  }
  if (steps.includes("classify")) {
    output.push({
      model: "step_2_classify",
      status: "completed",
      content: [
        {
          text: cls,
          additional_values: {
            document_type: { _value: cls, confidence: conf, confidence_score: score },
          },
        },
      ],
    });
  }
  if (steps.includes("extract")) {
    const av = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, { _value: v, confidence: "high" }]),
    );
    output.push({
      model: "Information Extract - Extract-1",
      status: "completed",
      content: [{ text: JSON.stringify(fields), additional_values: av }],
    });
  }
  return { status, output };
}

// Extract 출력이 객체가 아닌 경우 — job() 로는 만들 수 없어 직접 조립한다.
const ARRAY_EXTRACT_JOB = {
  status: "completed",
  output: [
    {
      model: "step_2_classify",
      status: "completed",
      content: [
        {
          text: "pay",
          additional_values: { document_type: { _value: "pay", confidence: "high" } },
        },
      ],
    },
    {
      model: "Information Extract - E",
      status: "completed",
      content: [{ text: "[1,2]", additional_values: {} }],
    },
  ],
};

const USERINFO_BYPASS_URL = "https://evil.com" + String.fromCharCode(92) + "@nhis.or.kr/x";

describe("findIssuer — 오매칭 차단", () => {
  // 역방향 부분 문자열을 허용하면 이 전부가 통과한다.
  it.each(["공단", "민", " ", "포항시민회", "가짜국민연금공단", "홍길동 국민건강보험공단 환급센터"])(
    "%s 는 매칭되지 않는다",
    (n) => {
      expect(findIssuer(n)).toBeNull();
    },
  );
  it.each([
    ["국민건강보험공단", "nhis"],
    ["국민연금공단 포항지사 복지지원팀", "nps"],
    ["포항시", "pohang"],
    ["한국전력공사", "kepco"],
  ])("%s → %s", (n, id) => {
    expect(findIssuer(n)?.issuer_id).toBe(id);
  });
  it.each([null, undefined, "", 0, false])("%s 는 null", (n) => {
    expect(findIssuer(n)).toBeNull();
  });
});

describe("normHost — 우회 차단", () => {
  it.each([
    "javascript://nhis.or.kr/x",
    USERINFO_BYPASS_URL,
    "https://nhis.or.kr:99999/x",
    "https://[nhis.or.kr",
    "https://user:pw@evil.com/",
  ])("%s 는 빈 값", (u) => {
    expect(normHost(u)).toBe("");
  });
  it("www 접두를 떼고 소문자로", () => {
    expect(normHost("https://WWW.NHIS.OR.KR/a")).toBe("nhis.or.kr");
  });
  it("문자열 포함 검사로는 통과하는 evil.com/go.kr 을 막는다", () => {
    expect(normHost("https://evil.com/go.kr")).toBe("evil.com");
  });
  it.each([null, undefined, ""])("%s 는 빈 값", (u) => {
    expect(normHost(u)).toBe("");
  });
});

describe("normPhone", () => {
  it("숫자만 남긴다", () => expect(normPhone("1577-1000")).toBe("15771000"));
  it.each([null, undefined])("%s 는 빈 문자열", (p) => expect(normPhone(p)).toBe(""));
});

describe("verify — 공격·결손 입력 19종 (security_test.py 회귀)", () => {
  const cases: [string, unknown, string][] = [
    ["정상 통제본", job(), "clear"],
    ["기관명 위조(가짜국민연금공단) — R7 로 review", job({ fields: { ...OK, issuer: "가짜국민연금공단" } }), "review"],
    ["기관명 한 글자(공단)", job({ fields: { ...OK, issuer: "공단" } }), "unknown_issuer"],
    ["기관명 공백", job({ fields: { ...OK, issuer: " " } }), "unknown_issuer"],
    ["유사 기관명(포항시민회)", job({ fields: { ...OK, issuer: "포항시민회" } }), "unknown_issuer"],
    ["javascript URL", job({ fields: { ...OK, info_url: "javascript://nhis.or.kr/x" } }), "review"],
    ["userinfo 우회 URL", job({ fields: { ...OK, info_url: USERINFO_BYPASS_URL } }), "review"],
    ["깨진 URL(IPv6)", job({ fields: { ...OK, info_url: "https://[nhis.or.kr" } }), "review"],
    ["대표번호 뒤 덧붙임", job({ fields: { ...OK, contact_phone: "1577-1000-666" } }), "review"],
    ["개인 휴대전화 상담번호", job({ fields: { ...OK, contact_phone: "010-4821-7733" } }), "mismatch"],
    ["예금주 위조", job({ fields: { ...OK, payee_name: "(주)건보수납대행" } }), "mismatch"],
    [
      "금액 결손",
      job({ fields: { issuer: OK.issuer, due_date: OK.due_date, contact_phone: OK.contact_phone } }),
      "review",
    ],
    ["job 실패 상태", job({ status: "failed" }), "failed"],
    ["job 대기중인데 output 존재", job({ status: "queued" }), "failed"],
    ["pay인데 Extract 없음", job({ steps: ["parse", "classify"] }), "failed"],
    ["Extract가 배열", ARRAY_EXTRACT_JOB, "failed"],
    ["분류 신뢰도 낮음", job({ cls: "info", conf: "low", score: 0.18 }), "needs_human"],
    ["광고(의도적 미매핑)", job({ cls: "ad", steps: ["parse", "classify"] }), "no_extract"],
    [
      "허용목록 밖 필드 포함",
      job({ fields: { ...OK, account_number: "110-555-123456", recipient_name: "이순자" } }),
      "clear",
    ],
  ];
  it("19종을 빠짐없이 옮겼다", () => expect(cases).toHaveLength(19));
  it.each(cases)("%s → %s", (_n, j, exp) => {
    expect(verify(j).verdict).toBe(exp);
  });
});

describe("verify — 저장 금지 필드", () => {
  it("허용목록 밖 필드는 폐기한다", () => {
    const r = verify(
      job({ fields: { ...OK, account_number: "110-555-123456", recipient_name: "이순자" } }),
    );
    expect(r.fields).not.toHaveProperty("account_number");
    expect(r.fields).not.toHaveProperty("recipient_name");
    expect(r.droppedFields).toEqual(["account_number", "recipient_name"]);
  });
});

describe("verify — 낭독 억제 (R3)", () => {
  it("핵심 필드 신뢰도가 low 면 억제한다", () => {
    const j = job();
    const ex = (j.output as Record<string, never>[])[2] as never as {
      content: { additional_values: Record<string, { confidence: string }> }[];
    };
    ex.content[0].additional_values.amount_krw.confidence = "low";
    const r = verify(j);
    expect(r.speechSuppressed).toBe(true);
    expect(r.verdict).toBe("review");
  });
  it("필수 필드가 결손이면 억제한다", () => {
    const r = verify(job({ fields: { issuer: OK.issuer, due_date: OK.due_date } }));
    expect(r.speechSuppressed).toBe(true);
  });
  it("정상 통제본은 억제하지 않는다", () => {
    expect(verify(job()).speechSuppressed).toBe(false);
  });
});

describe("verify — 안전 연락처는 레지스트리 값만", () => {
  it("clear 판정에 공식 번호·출처·확인일이 실린다", () => {
    const r = verify(job());
    expect(r.safeContact?.phones).toEqual(["1577-1000"]);
    expect(r.safeContact?.source?.length).toBeGreaterThan(0);
    expect(r.safeContact?.verifiedAt).toBeTruthy();
  });
  it("unknown_issuer 에는 안전 연락처가 없다 (유사 이름 사칭 의심은 예외 — 등록 기관의 공식 번호를 준다)", () => {
    expect(verify(job({ fields: { ...OK, issuer: "주식회사 케이티", payee_name: "" } })).safeContact).toBeUndefined();
    // 가짜국민연금공단은 R7 이 국민연금공단의 공식 번호를 안전 연락처로 준다 — 문서의 번호가 아니라 레지스트리 값이다.
    expect(verify(job({ fields: { ...OK, issuer: "가짜국민연금공단" } })).safeContact?.phones).toContain("1355");
  });
});

describe("verify — 검사 건수", () => {
  it("셀 수 없는 검사(ok=null)는 분모에서 뺀다", () => {
    const r = verify(job());
    expect(r.checksTotal).toBe(r.checks.filter((c) => c.ok !== null).length);
    expect(r.checksPassed).toBe(r.checks.filter((c) => c.ok === true).length);
    expect(r.checksPassed).toBe(r.checksTotal);
  });
  it("계좌 진위는 확인하지 않는다고 명시한다", () => {
    const c = verify(job()).checks.find((c) => c.name === "계좌 진위");
    expect(c?.ok).toBeNull();
    expect(c?.note).toContain("확인하지 않음");
  });
});

describe("verify — 방어적 입력", () => {
  it.each([null, undefined, {}, { status: "completed" }, { status: "completed", output: [] }])(
    "%s 에도 예외를 던지지 않는다",
    (j) => {
      expect(() => verify(j)).not.toThrow();
      expect(verify(j).verdict).toBe("failed");
    },
  );
  it("단계 하나가 실패면 job 전체를 실패로 본다", () => {
    const j = job();
    (j.output as { status: string }[])[2].status = "failed";
    expect(verify(j).verdict).toBe("failed");
  });
});

describe("R7 — 사칭 의심(미등록 + 공공요금 명칭 + 민간법인/유사 이름)", () => {
  it("서울고수도요금주식회사 → review, 서울아리수본부 공식 번호를 안전 연락처로", () => {
    const r = verify(
      job({ fields: { ...OK, issuer: "서울고수도요금주식회사", doc_title: "상수도요금 납부고지서", contact_phone: "02-1234-5678", info_url: "www.seoul-water.or.kr", payee_name: "" } }),
    );
    expect(r.verdict).toBe("review");
    expect(r.reasons.some((x) => x.rule === "R7" && x.detail.includes("주식회사"))).toBe(true);
    expect(r.safeContact?.phones).toContain("120");
  });
  it("가짜국민연금공단 → 등록 기관과 비슷한 이름이라 review (clear 로는 절대 안 올라간다)", () => {
    const r = verify(job({ fields: { ...OK, issuer: "가짜국민연금공단" } }));
    expect(r.verdict).toBe("review");
    expect(r.issuerId).toBeUndefined();
  });
  it("공공 명칭이 없는 미등록 민간사(주식회사 케이티)는 그대로 unknown_issuer", () => {
    const r = verify(job({ fields: { ...OK, issuer: "주식회사 케이티", contact_phone: "100", info_url: "www.kt.com", payee_name: "" } }));
    expect(r.verdict).toBe("unknown_issuer");
  });
  it("부산광역시 상하수도 사업본부 — 시연용(demo) 등록 기관. 인쇄본 값과 일치하면 clear", () => {
    const r = verify(
      job({ fields: { ...OK, issuer: "부산광역시 상하수도 사업본부", doc_title: "상하수도요금 독촉 고지서", contact_phone: "051-123-4567", info_url: "www.busan-water.kr", payee_name: "부산광역시 상하수도" } }),
    );
    expect(r.issuerId).toBe("busan_water");
    expect(r.verdict).toBe("clear");
  });
  it("분류 low 지만 점수 0.92 — 추출을 계속해 대조로 판단 (법원 결정문)", () => {
    const r = verify(job({ cls: "apply", conf: "low", score: 0.92, fields: { issuer: "부산지방법원", doc_title: "지급명령 결정문", contact_phone: "051-590-3114", info_url: "www.scourt.go.kr", apply_deadline: "" } }));
    expect(r.verdict).not.toBe("needs_human");
    expect(r.issuerId).toBe("busan_court");
  });
  it("분류 low 에 점수 0.18 은 여전히 needs_human", () => {
    expect(verify(job({ cls: "info", conf: "low", score: 0.18 })).verdict).toBe("needs_human");
  });
  it("부산지방법원 — 공식 번호·도메인이면 clear", () => {
    const r = verify(
      job({ fields: { ...OK, issuer: "부산지방법원", doc_title: "소송 서류 송달", contact_phone: "051-590-1114", info_url: "busan.scourt.go.kr", payee_name: "" } }),
    );
    expect(r.issuerId).toBe("busan_court");
    expect(r.verdict).toBe("clear");
  });
});
