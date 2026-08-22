import { REGISTRY } from "./registry";
import type { Check, Issuer, Reason, VerifyResult, Verdict } from "./types";

// 정합성 검증 계층. Studio 응답 → verdict + 검사 건수 + 근거.
// scripts/verify.py 의 규칙을 그대로 옮긴 것이다. 판정이 갈리면 Python 쪽이 기준이다.
// R1(발신 정합성)·R3(신뢰도 게이트)·R4(개인 휴대전화)·R5(분류 신뢰도)·R6(예금주)가 여기 있다.
// R2(문서 내부 정합성)는 Studio Validate 노드 담당이고 우리 구성에는 없다.

// alias 뒤에 붙어도 같은 기관으로 인정하는 하위 조직 꼬리
const BRANCH_TAIL =
  /^([가-힣A-Za-z0-9]{0,12}(지사|지역본부|본부|지점|센터|출장소|사무소|과|팀|담당관|반|부))+$/;
const MIN_ALIAS = 3;
const MOBILE = /^01[016789]/;
const CTRL = /[\x00-\x1f\x7f]/;
const BACKSLASH = String.fromCharCode(92);
const ALLOWED_SCHEME = new Set(["http", "https"]);

// 허용목록 밖 필드는 저장하지 않는다. account_number·recipient_name 등은 폐기한다.
const ALLOW_FIELDS = new Set([
  "issuer",
  "doc_title",
  "epn",
  "amount_krw",
  "issue_date",
  "due_date",
  "contact_phone",
  "info_url",
  "payee_name",
  "apply_deadline",
  "required_docs",
  "where_to_apply",
  "summary",
]);

const REQUIRED: Record<string, string[]> = {
  pay: ["issuer", "amount_krw", "due_date"],
  apply: ["issuer", "apply_deadline"],
  info: ["issuer"],
};

const CORE = ["amount_krw", "due_date", "apply_deadline", "issuer"];

export const normPhone = (p: unknown) => String(p ?? "").replace(/[^0-9]/g, "");

/** 기관은 대표번호(15xx/16xx/18xx/국번없는 3자리/지역번호)를 쓴다.
 *  상담 번호가 개인 휴대전화면 이상 신호다. */
export const isPersonalMobile = (p: unknown) => MOBILE.test(normPhone(p));

/** URL에서 host만 뽑는다. 경계 비교용 — 부분 문자열 검사는 `evil.com/go.kr` 을 통과시킨다.
 *  파싱 실패·비허용 scheme·userinfo·역슬래시·제어문자는 전부 빈 값으로 닫는다(fail-closed). */
export function normHost(u: unknown): string {
  if (u === null || u === undefined) return "";
  const raw = String(u).trim();
  if (!raw) return "";
  if (raw.includes(BACKSLASH) || CTRL.test(raw)) return "";
  let s = raw;
  if (s.includes("://")) {
    if (!ALLOWED_SCHEME.has(s.split("://")[0].toLowerCase())) return "";
  } else {
    s = "http://" + s;
  }
  try {
    const url = new URL(s);
    if (url.username || url.password) return "";
    if (url.port) {
      const p = Number(url.port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) return "";
    }
    const h = url.hostname.toLowerCase();
    if (!h || h.includes(" ")) return "";
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return "";
  }
}

/** 기관명 매칭. 정확 일치 우선, 그다음 'alias로 시작 + 나머지가 하위 조직 꼬리'만 인정한다.
 *  역방향 부분 문자열 매칭은 하지 않는다 — '공단'·'민'이 매칭되고 '가짜국민연금공단'이 통과한다. */
export function findIssuer(name: unknown): Issuer | null {
  if (name === null || name === undefined) return null;
  const n = String(name).replace(/\s+/g, "");
  if (n.length < MIN_ALIAS) return null;
  let best: [Issuer, number] | null = null;
  for (const it of REGISTRY.issuers) {
    for (const a of it.aliases) {
      const na = a.replace(/\s+/g, "");
      if (na.length < MIN_ALIAS) continue;
      if (n === na) return it;
      if (n.startsWith(na) && BRANCH_TAIL.test(n.slice(na.length))) {
        if (!best || na.length > best[1]) best = [it, na.length];
      }
    }
  }
  return best ? best[0] : null;
}

type AdditionalValues = Record<string, { _value?: unknown; confidence?: string } | undefined>;
type Step = { value: unknown; av: AdditionalValues };

type JobOutput = {
  model?: unknown;
  status?: unknown;
  content?: { text?: unknown; additional_values?: unknown }[];
};
type Job = { status?: unknown; output?: JobOutput[] };

/** output[].model 로 단계를 찾는다. 배열 순번 접근 금지 — 분기로 단계가 생략된다.
 *  Extract 는 `step_N` 형식이 아니라 "Information Extract - Extract-1" 처럼 온다. */
function pickSteps(job: Job): Record<string, Step> {
  const steps: Record<string, Step> = {};
  for (const o of job?.output ?? []) {
    const m = String(o?.model ?? "").toLowerCase();
    const c = o?.content?.[0] ?? {};
    // additional_values 는 객체로 오지만 문자열로 오는 경우가 있다.
    let av: unknown = c.additional_values ?? {};
    if (typeof av === "string") {
      try {
        av = JSON.parse(av);
      } catch {
        av = {};
      }
    }
    if (typeof av !== "object" || av === null) av = {};
    const txt = c.text;
    let value: unknown = txt;
    if (typeof txt === "string" && txt.trim().startsWith("{")) {
      try {
        value = JSON.parse(txt);
      } catch {
        /* 원문 유지 */
      }
    }
    const key = m.includes("parse")
      ? "parse"
      : m.includes("classify")
        ? "classify"
        : m.includes("extract")
          ? "extract"
          : m.includes("instruct")
            ? "instruct"
            : m.includes("validate")
              ? "validate"
              : null;
    if (key) steps[key] = { value, av: av as AdditionalValues };
  }
  return steps;
}

export function verify(job: unknown): VerifyResult {
  const j = (job ?? {}) as Job;
  const base: VerifyResult = { verdict: "failed", checks: [], reasons: [] };

  // 잡 상태를 먼저 강제한다. stale output 으로 통과시키지 않는다.
  if (j.status !== "completed") return { ...base, reason: `job status=${j.status}` };
  for (const o of j.output ?? []) {
    if (o?.status && o.status !== "completed") {
      return { ...base, reason: `step ${o.model} status=${o.status}` };
    }
  }

  const st = pickSteps(j);
  if (!st.classify) return { ...base, reason: "classify 단계 없음" };

  const out: VerifyResult = { ...base, checks: [], reasons: [] };
  const docType = String(st.classify.value ?? "");
  const clsAv = (st.classify.av?.document_type ?? {}) as {
    confidence?: string;
    confidence_score?: number;
  };
  out.actionType = docType;
  out.classifyConfidence = clsAv.confidence;
  out.classifyScore = clsAv.confidence_score;

  // R5 — 분류 자체를 못 믿으면 사람에게 보낸다 (손글씨·비정형 문서)
  if (clsAv.confidence === "low") {
    out.verdict = "needs_human";
    out.reasons.push({
      rule: "R5",
      detail: `문서 종류를 확신하지 못함 (분류 신뢰도 ${clsAv.confidence_score})`,
      action: "자녀가 직접 확인",
    });
    return out;
  }

  if (!st.extract) {
    // 미매핑 타입은 Extract 단계가 응답에서 통째로 빠진다(빈 결과가 아니다).
    if (["pay", "apply", "info"].includes(docType)) {
      return {
        ...out,
        verdict: "failed",
        reason: `'${docType}' 문서인데 Extract 단계가 없음 — 파이프라인 오류`,
      };
    }
    // 의도적 미매핑 타입 — 추출은 생략하되 자녀 목록에는 남는다. 폐기를 지시하지 않는다.
    out.verdict = "no_extract";
    return out;
  }

  const rawFields = st.extract.value;
  if (typeof rawFields !== "object" || rawFields === null || Array.isArray(rawFields)) {
    return { ...out, verdict: "failed", reason: "Extract 출력이 객체가 아님" };
  }

  const av = st.extract.av ?? {};
  const conf: Record<string, string> = {};
  for (const [k, v] of Object.entries(av)) {
    if (v && typeof v === "object" && "_value" in v && typeof v.confidence === "string") {
      conf[k] = v.confidence;
    }
  }

  const entries = Object.entries(rawFields as Record<string, unknown>);
  const dropped = entries.map(([k]) => k).filter((k) => !ALLOW_FIELDS.has(k)).sort();
  const fields: Record<string, unknown> = {};
  for (const [k, v] of entries) if (ALLOW_FIELDS.has(k)) fields[k] = v;
  out.fields = fields;
  out.fieldConfidence = conf;
  if (dropped.length) out.droppedFields = dropped;

  // R3 — 신뢰도 게이트: 핵심 필드에 low 가 있거나 필수 필드가 비면 숫자를 말하지 않는다.
  const missing = (REQUIRED[docType] ?? []).filter((k) => !String(fields[k] ?? "").trim());
  const lowCore = CORE.filter((k) => conf[k] === "low");
  out.speechSuppressed = lowCore.length > 0 || missing.length > 0;
  if (lowCore.length) {
    out.reasons.push({
      rule: "R3",
      detail: `핵심 필드 신뢰도 낮음: ${lowCore.join(", ")}`,
      action: "숫자 낭독 억제 + 자녀 확인",
    });
  }
  if (missing.length) {
    out.reasons.push({
      rule: "R3",
      detail: `필수 필드 결손: ${missing.join(", ")}`,
      action: "숫자 낭독 억제 + 자녀 확인",
    });
  }

  // R4 — 개인 휴대전화 상담번호 (레지스트리 등록 여부와 무관하게 본다)
  const phone = fields.contact_phone as string | undefined;
  const mobileHit = !!phone && isPersonalMobile(phone);
  const mobileStrong = mobileHit && conf.contact_phone === "high";
  if (mobileHit) {
    out.reasons.push({
      rule: "R4",
      detail: `고지서 상담 번호가 개인 휴대전화입니다: ${phone}`,
      action: "이 번호로 연락하지 말 것. 기관 공식 대표번호만 사용",
    });
  }

  // R1 — 발신 정합성
  const issuer = findIssuer(fields.issuer);
  if (!issuer) {
    out.verdict = mobileStrong ? "mismatch" : "unknown_issuer";
    if (!mobileStrong) {
      out.reasons.push({
        rule: "R1",
        detail: `레지스트리에 없는 기관: ${fields.issuer}`,
        action: "판단 불가 — 자녀 확인",
      });
    }
    if (phone) {
      out.checks.push({
        name: "상담 번호 형식",
        value: phone,
        ok: conf.contact_phone === "high" ? !mobileHit : null,
        note: conf.contact_phone === "high" ? undefined : "읽기가 불확실함",
        expected: ["기관 대표번호"],
        kind: "mobile",
      });
    }
    countChecks(out);
    return out;
  }
  out.issuerId = issuer.issuer_id;

  let urlUnparseable = false;

  // 필드별 독립 판정. 한 필드가 비었거나 low 여도 다른 필드 대조는 계속한다.
  if (phone && phone.trim()) {
    const np = normPhone(phone);
    const exact = issuer.official_phones.some((x) => normPhone(x) === np);
    // 같은 국번 대역이면 부서 직통번호로 인정한다. 기관은 대표번호 하나만 쓰지 않는다.
    // 대표번호를 prefix 에 넣으면 '1577-1000-666' 이 통과하므로 레지스트리 쪽에서 막는다.
    const prefix = (issuer.phone_prefixes ?? []).some((x) => x && np.startsWith(normPhone(x)));
    let ok: boolean | null = exact || prefix;
    let note: string | undefined = exact
      ? undefined
      : prefix
        ? "같은 국번 대역 — 부서 직통번호로 인정"
        : undefined;
    if (ok && conf.contact_phone !== "high") {
      ok = null;
      note = "읽기가 불확실해 대조 결과를 인정하지 않음";
      out.reasons.push({ rule: "R3", detail: "문의전화 읽기가 불확실함", action: "자녀 확인" });
    }
    out.checks.push({
      name: "문의전화",
      value: phone,
      ok,
      note,
      expected: issuer.official_phones,
      conf: conf.contact_phone,
      kind: "phone",
    });
  } else {
    out.checks.push({
      name: "문의전화",
      value: null,
      ok: null,
      expected: null,
      note: "문서에서 읽지 못함",
    });
  }

  const url = fields.info_url as string | undefined;
  if (url && url.trim()) {
    const h = normHost(url);
    if (!h) {
      out.checks.push({
        name: "안내 주소",
        value: String(url).slice(0, 60),
        ok: null,
        expected: null,
        note: "주소 형식을 해석할 수 없음",
        kind: "host",
      });
      out.reasons.push({
        rule: "R1",
        detail: `안내 주소를 해석할 수 없음: ${String(url).slice(0, 60)}`,
        action: "자녀 확인 — 문서의 링크를 열지 말 것",
      });
      urlUnparseable = true;
    } else {
      const exp = Array.from(new Set(issuer.official_hosts.map(normHost))).sort();
      let ok: boolean | null = exp.includes(h);
      if (ok && conf.info_url !== "high") ok = null;
      out.checks.push({
        name: "안내 주소",
        value: h,
        ok,
        expected: exp,
        conf: conf.info_url,
        kind: "host",
      });
    }
  } else {
    out.checks.push({
      name: "안내 주소",
      value: null,
      ok: null,
      expected: null,
      note: "문서에 없음",
    });
  }

  if (phone && phone.trim()) {
    out.checks.push({
      name: "상담 번호 형식",
      value: phone,
      ok: conf.contact_phone === "high" ? !mobileHit : null,
      note: conf.contact_phone === "high" ? undefined : "읽기가 불확실함",
      expected: ["기관 대표번호"],
      kind: "mobile",
    });
  }

  // R6 — 예금주 정합성. 공공기관 고지서의 가상계좌 예금주는 그 기관이어야 한다.
  // 은행명은 대조하지 않는다(사기 계좌도 같은 은행에 만들 수 있다). 예금주는 다르다.
  const payee = fields.payee_name as string | undefined;
  if (payee && payee.trim()) {
    const pn = payee.replace(/[\s()[\]]|주식회사|㈜/g, "");
    const matched = findIssuer(payee);
    const same =
      (!!matched && matched.issuer_id === issuer.issuer_id) ||
      issuer.aliases.some((a) => pn.includes(a.replace(/\s/g, "")));
    out.checks.push({
      name: "가상계좌 예금주",
      value: payee,
      ok: same,
      expected: [issuer.display_name],
      conf: conf.payee_name,
      kind: "payee",
    });
    if (!same) {
      out.reasons.push({
        rule: "R6",
        detail: `가상계좌 예금주가 발급기관과 다릅니다: '${payee}' (발급기관 ${issuer.display_name})`,
        action: "이 계좌로 송금하지 말 것. 기관 공식 대표번호로 사실 확인",
      });
    }
  }

  out.checks.push({
    name: "계좌 진위",
    value: null,
    ok: null,
    expected: null,
    note: "확인하지 않음 — 계좌 명의 조회 권한 없음",
  });

  const real = countChecks(out);
  const failed = real.filter((c) => !c.ok);

  // 전화번호 단독 불일치는 mismatch 로 올리지 않는다 — 기관에는 부서 직통번호가 있다.
  // 확정 신호는 개인 휴대전화(R4)·도메인 불일치·예금주 불일치(R6)뿐이다.
  const hardFail = failed.filter(
    (c) => c.conf !== "low" && ["mobile", "host", "payee"].includes(c.kind ?? ""),
  );
  const softFail = failed.filter((c) => !hardFail.includes(c));

  if (!real.length) {
    out.verdict = "not_checkable";
    out.reasons.push({
      rule: "R1",
      detail: "대조할 연락처·주소를 읽지 못함",
      action: "자녀 확인",
    });
  } else if (hardFail.length) {
    out.verdict = "mismatch";
    for (const c of hardFail) {
      out.reasons.push({
        rule: "R1",
        detail: `${c.name} 불일치: 문서 '${c.value}' vs 공식 ${JSON.stringify(c.expected)}`,
        action: "공식 번호로만 연락. 문서의 번호·링크 사용 금지",
      });
    }
  } else if (softFail.length) {
    out.verdict = "review";
    for (const c of softFail) {
      const why =
        c.conf === "low" ? "읽기가 불확실함" : "등록된 공식 번호와 다름(부서 직통일 수 있음)";
      out.reasons.push({
        rule: "R1",
        detail: `${c.name} ${why}: '${c.value}'`,
        action: "자녀 확인 — 기관 공식 대표번호로 사실 확인 권장",
      });
    }
  } else if (lowCore.length || missing.length || urlUnparseable) {
    out.verdict = "review";
  } else {
    // 'clear' 는 "확인된 불일치 없음"이다. '정상'·'진짜'·'안전'이 아니다.
    out.verdict = "clear";
  }

  out.safeContact = {
    phones: issuer.official_phones,
    hosts: issuer.official_hosts,
    source: issuer.source_urls,
    verifiedAt: issuer.verified_at,
  };
  return out;
}

/** 셀 수 없는 검사(ok=null)는 분모에서 뺀다. */
function countChecks(out: VerifyResult): Check[] {
  const real = out.checks.filter((c) => c.ok !== null);
  out.checksTotal = real.length;
  out.checksPassed = real.filter((c) => c.ok).length;
  return real;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  clear: "확인된 불일치 없음",
  review: "확인 필요",
  mismatch: "공식 정보와 다른 항목 발견",
  unknown_issuer: "판단 불가 (등록되지 않은 기관)",
  not_checkable: "대조할 연락처를 읽지 못함",
  no_extract: "추출 대상 아님",
  needs_human: "사람이 확인해야 함",
  failed: "처리 실패",
};

export type { Check, Reason, Issuer, VerifyResult, Verdict };
