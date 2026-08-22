import { REGISTRY } from "./registry";
import type { Check, Issuer, Reason, VerifyResult, Verdict } from "./types";

// 정합성 검증 계층. Studio 응답 → verdict + 검사 건수 + 근거.
// R1(발신 정합성)·R3(신뢰도 게이트)·R4(개인 휴대전화)·R5(분류 신뢰도)·R6(예금주)가 여기 있다.
// R2(문서 내부 정합성)는 Studio Validate 노드 담당이고 우리 구성에는 없다.
//
// scripts/verify.py 에서 옮겨왔지만 **원본과 같지 않다**. 원본에 있던 우회 경로를 닫았다:
//   · 예금주 부분 문자열 매칭 → 완전 일치 (`홍길동국민건강보험공단` 이 통과했다)
//   · 전화번호 전체 이어붙이기 → 토큰별 검사 (`054-270-6230 / 010-4821-7733` 이 통과했다)
//   · 하위조직 꼬리 매칭을 clear 로 인정 → review 상한 (`국민건강보험공단가짜환급센터` 가 통과했다)
//   · 꼬리 정규식 ReDoS (본부x16 에 TS 836ms · Python 8.9s)
//   · text 와 additional_values._value 불일치 무시 → _value 를 단일 진실로
//   · 분류 타입·상태·신뢰도 계약 미검사(fail-open) → 화이트리스트로 fail-closed
//   · 문자열 아닌 필드에서 예외 → 런타임 방어

const MIN_ALIAS = 3;
const MAX_ISSUER_NAME = 60;
const MOBILE = /^01[016789]/;
const CTRL = /[\x00-\x1f\x7f]/;
const BACKSLASH = String.fromCharCode(92);
const ALLOWED_SCHEME = new Set(["http", "https"]);

// alias 뒤에 붙어도 같은 기관으로 보는 하위 조직 꼬리.
// 중첩 수량자를 쓰지 않는다 — 원본의 `(...)+` 는 '본부'를 16번 반복하면 8.9초가 걸렸다.
const BRANCH_TAIL =
  /^[가-힣A-Za-z0-9]{0,24}(지역본부|출장소|사무소|담당관|지사|지점|센터|본부|과|팀|반|부)$/;

// 전화번호 토큰. 구분자로 이어진 숫자 덩어리를 각각 뽑는다.
const PHONE_TOKEN = /[0-9][0-9\s.\-‐-―]*[0-9]|[0-9]/g;
const PHONE_MIN_FULL = 9; // 국내 유선 전체 번호 자릿수
const PHONE_MAX_FULL = 11;

// Studio 파이프라인이 내는 분류 타입. 이 밖의 값은 신뢰하지 않는다.
const DOC_TYPES = new Set(["pay", "apply", "info", "ad"]);
const EXTRACT_TYPES = new Set(["pay", "apply", "info"]);
const CONFIDENCE = new Set(["high", "low"]);
const JOB_STATUS = new Set(["queued", "in_progress", "completed", "failed"]);

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
const DATE_FIELDS = new Set(["due_date", "issue_date", "apply_deadline"]);
const AMOUNT_FIELDS = new Set(["amount_krw"]);

// ── 값 유틸 ──────────────────────────────────────────────────

/** Python 의 `not (x or "").strip()` 과 같은 결손 판정. 0·false 도 결손이다. */
const isBlank = (v: unknown) => !v || String(v).trim() === "";

/** 문자열로 다룰 수 있는 값만 문자열로. 객체·배열은 빈 문자열이 되어 뒤에서 결손 처리된다. */
function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return "";
}

export const normPhone = (p: unknown) => asText(p).replace(/[^0-9]/g, "");

/** 번호가 여러 개 적힌 고지서가 있다. 이어 붙이면 `054-270-6230 / 010-4821-7733` 이
 *  `054270623001048217733` 이 되어 국번 검사는 통과하고 휴대전화 검사는 빠져나간다. */
export function phoneTokens(raw: unknown): string[] {
  const s = asText(raw).normalize("NFKC");
  const out = new Set<string>();
  for (const m of s.matchAll(PHONE_TOKEN)) {
    const d = m[0].replace(/[^0-9]/g, "");
    if (d.length >= 3) out.add(d);
  }
  return [...out];
}

/** 기관은 대표번호(15xx/16xx/18xx/국번없는 3자리/지역번호)를 쓴다.
 *  상담 번호 중 하나라도 개인 휴대전화면 이상 신호다. */
export const isPersonalMobile = (p: unknown) => phoneTokens(p).some((t) => MOBILE.test(t));

/** 실제 달력 날짜인지 본다. `2026-99-99` 를 통과시키면 "구십구월 구십구일"을 낭독한다. */
export function isValidDate(v: unknown): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asText(v).trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 금액은 0 이상 정수여야 한다. `false`·`"확인 요망"`·소수는 금액이 아니다. */
export function isValidAmount(v: unknown): boolean {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0;
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!/^[0-9][0-9,]*원?$/.test(s)) return false;
  const n = Number(s.replace(/[^0-9]/g, ""));
  return Number.isSafeInteger(n) && n >= 0;
}

/** 법인 표기를 지운 정규형. 예금주 완전 일치 비교용. */
export function normOrg(s: unknown): string {
  return asText(s)
    .normalize("NFKC")
    .replace(/주식회사|㈜|\(주\)/g, "")
    .replace(/[\s()[\]{}<>·.,'"`~!@#$%^&*_+=|\\/?:;-]/g, "")
    .toLowerCase();
}

/** URL에서 host만 뽑는다. 경계 비교용 — 부분 문자열 검사는 `evil.com/go.kr` 을 통과시킨다.
 *  파싱 실패·비허용 scheme·userinfo·역슬래시·제어문자는 전부 빈 값으로 닫는다(fail-closed). */
export function normHost(u: unknown): string {
  const raw = asText(u).trim();
  if (!raw) return "";
  if (raw.includes(BACKSLASH) || CTRL.test(raw)) return "";
  // `//host/path` 는 scheme 상대 URL 이다. 문서에 이런 값이 적힐 이유가 없다.
  if (raw.startsWith("//")) return "";
  let s = raw;
  if (s.includes("://")) {
    if (!ALLOWED_SCHEME.has(s.split("://")[0].toLowerCase())) return "";
    // 빈 userinfo(`https://@host/`)도 거부한다. 정상 문서에 나올 수 없다.
    const authority = s.slice(s.indexOf("://") + 3).split(/[/?#]/)[0];
    if (authority.includes("@")) return "";
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
    const noWww = h.startsWith("www.") ? h.slice(4) : h;
    // 후행 점(`nhis.or.kr.`)은 같은 목적지지만 문자열 비교에서 갈린다. 떼어서 비교한다.
    return noWww.endsWith(".") ? noWww.slice(0, -1) : noWww;
  } catch {
    return "";
  }
}

// ── 기관 매칭 ────────────────────────────────────────────────

export type IssuerMatch = { issuer: Issuer; match: "exact" | "branch" };

/** 정확 일치 우선, 그다음 'alias로 시작 + 나머지가 하위 조직 꼬리'.
 *  역방향 부분 문자열 매칭은 하지 않는다 — '공단'·'민'이 매칭되고 '가짜국민연금공단'이 통과한다.
 *
 *  꼬리 매칭은 **구조만 보므로 `포항지사`와 `가짜환급센터`를 구분하지 못한다.**
 *  그래서 호출자는 match==='branch' 를 clear 로 올리지 않는다. */
export function matchIssuer(name: unknown): IssuerMatch | null {
  if (name === null || name === undefined) return null;
  const n = asText(name).replace(/\s+/g, "");
  if (n.length < MIN_ALIAS || n.length > MAX_ISSUER_NAME) return null;
  let best: [Issuer, number] | null = null;
  for (const it of REGISTRY.issuers) {
    for (const a of it.aliases) {
      const na = a.replace(/\s+/g, "");
      if (na.length < MIN_ALIAS) continue;
      if (n === na) return { issuer: it, match: "exact" };
      if (n.startsWith(na) && BRANCH_TAIL.test(n.slice(na.length))) {
        if (!best || na.length > best[1]) best = [it, na.length];
      }
    }
  }
  return best ? { issuer: best[0], match: "branch" } : null;
}

export const findIssuer = (name: unknown): Issuer | null => matchIssuer(name)?.issuer ?? null;

/** R6 — 예금주는 완전 일치만 인정한다.
 *  `includes()` 로 비교하면 `홍길동국민건강보험공단`·`EVILNHIS`·`국민건강보험공단사칭수납대행`이
 *  전부 통과한다. 기관명 매칭에서 금지한 역방향 부분 문자열이 여기서 되살아났던 자리다. */
export function isOfficialPayee(payee: unknown, issuer: Issuer): boolean {
  const p = normOrg(payee);
  if (!p) return false;
  return [issuer.display_name, ...issuer.aliases].some((a) => normOrg(a) === p);
}

function phoneMatches(token: string, issuer: Issuer): { ok: boolean; viaPrefix: boolean } {
  if (issuer.official_phones.some((x) => normPhone(x) === token)) return { ok: true, viaPrefix: false };
  // 같은 국번 대역이면 부서 직통번호로 인정한다. 기관은 대표번호 하나만 쓰지 않는다.
  // 전체 자릿수까지 강제하지 않으면 `054-270` 만 적어도 통과한다.
  const viaPrefix = (issuer.phone_prefixes ?? []).some((x) => {
    const np = normPhone(x);
    if (np.length < 4) return false;
    // 대표번호를 prefix 로 쓰면 `1577-1000-666` 이 통과한다.
    if (issuer.official_phones.some((o) => normPhone(o) === np)) return false;
    return (
      token.startsWith(np) && token.length >= PHONE_MIN_FULL && token.length <= PHONE_MAX_FULL
    );
  });
  return { ok: viaPrefix, viaPrefix };
}

// ── 응답 파싱 ────────────────────────────────────────────────

type AdditionalValue = { _value?: unknown; confidence?: unknown };
type AdditionalValues = Record<string, AdditionalValue | undefined>;
type Step = { value: unknown; av: AdditionalValues };

type JobOutput = {
  model?: unknown;
  status?: unknown;
  content?: unknown;
};
type Job = { status?: unknown; output?: unknown };

function stepKey(model: string): string | null {
  const m = model.toLowerCase();
  if (m.includes("parse")) return "parse";
  if (m.includes("classify")) return "classify";
  if (m.includes("extract")) return "extract";
  if (m.includes("instruct")) return "instruct";
  if (m.includes("validate")) return "validate";
  return null;
}

/** output[].model 로 단계를 찾는다. 배열 순번 접근 금지 — 분기로 단계가 생략된다.
 *  Extract 는 `step_N` 형식이 아니라 "Information Extract - Extract-1" 처럼 온다.
 *  같은 단계가 두 번 오면 계약 위반이다 — 뒤 값으로 덮으면 앞의 악성 Extract 를 숨길 수 있다. */
function pickSteps(output: JobOutput[]): { steps: Record<string, Step>; duplicated: string[] } {
  const steps: Record<string, Step> = {};
  const duplicated: string[] = [];
  for (const o of output) {
    const key = stepKey(String(o?.model ?? ""));
    if (!key) continue;
    if (key in steps) {
      duplicated.push(key);
      continue;
    }
    const content = Array.isArray(o?.content) ? o.content : [];
    const c = (content[0] ?? {}) as { text?: unknown; additional_values?: unknown };
    let av: unknown = c.additional_values ?? {};
    // additional_values 는 객체로 오지만 문자열로 오는 경우가 있다.
    if (typeof av === "string") {
      try {
        av = JSON.parse(av);
      } catch {
        av = {};
      }
    }
    if (typeof av !== "object" || av === null || Array.isArray(av)) av = {};
    const txt = c.text;
    let value: unknown = txt;
    if (typeof txt === "string" && txt.trim().startsWith("{")) {
      try {
        value = JSON.parse(txt);
      } catch {
        /* 원문 유지 */
      }
    }
    steps[key] = { value, av: av as AdditionalValues };
  }
  return { steps, duplicated };
}

const sameValue = (a: unknown, b: unknown) =>
  a === b || (a !== null && b !== null && String(a).trim() === String(b).trim());

// ── 본체 ────────────────────────────────────────────────────

export function verify(job: unknown): VerifyResult {
  const j = (typeof job === "object" && job !== null ? job : {}) as Job;
  const base: VerifyResult = { verdict: "failed", checks: [], reasons: [] };

  // 잡 상태를 먼저 강제한다. stale output 으로 통과시키지 않는다.
  if (typeof j.status !== "string" || !JOB_STATUS.has(j.status)) {
    return { ...base, reason: `job status=${String(j.status)}` };
  }
  if (j.status !== "completed") return { ...base, reason: `job status=${j.status}` };
  if (j.output !== undefined && !Array.isArray(j.output)) {
    return { ...base, reason: "output 이 배열이 아님" };
  }
  const output = (j.output ?? []) as JobOutput[];
  for (const o of output) {
    if (typeof o !== "object" || o === null) return { ...base, reason: "output 항목이 객체가 아님" };
    // 빈 문자열·0·false 도 completed 가 아니다. 여기서 느슨하면 실패한 단계가 통과한다.
    if ("status" in o && o.status !== undefined && o.status !== "completed") {
      return { ...base, reason: `step ${String(o.model)} status=${String(o.status)}` };
    }
  }

  const { steps: st, duplicated } = pickSteps(output);
  if (duplicated.length) {
    return { ...base, reason: `단계 중복: ${duplicated.join(", ")}` };
  }
  if (!st.classify) return { ...base, reason: "classify 단계 없음" };

  const out: VerifyResult = { ...base, checks: [], reasons: [] };
  const docType = asText(st.classify.value).trim().toLowerCase();
  const clsAvRaw = st.classify.av?.document_type;
  const clsAv = (typeof clsAvRaw === "object" && clsAvRaw !== null ? clsAvRaw : {}) as {
    confidence?: unknown;
    confidence_score?: unknown;
    _value?: unknown;
  };
  const clsConf = typeof clsAv.confidence === "string" ? clsAv.confidence : undefined;
  out.actionType = docType;
  out.classifyConfidence = clsConf;
  out.classifyScore =
    typeof clsAv.confidence_score === "number" ? clsAv.confidence_score : undefined;

  // R5 — 분류 계약을 강제한다. 신뢰도가 없거나 범주 밖이면 high 로 봐서는 안 된다.
  if (!clsConf || !CONFIDENCE.has(clsConf)) {
    out.verdict = "needs_human";
    out.reasons.push({
      rule: "R5",
      detail: "분류 신뢰도를 읽지 못함 (응답 계약 위반)",
      action: "자녀가 직접 확인",
    });
    return out;
  }
  if (clsAv._value !== undefined && !sameValue(clsAv._value, docType)) {
    out.verdict = "needs_human";
    out.reasons.push({
      rule: "R5",
      detail: "분류 결과가 서로 다르게 적혀 있음 (응답 계약 위반)",
      action: "자녀가 직접 확인",
    });
    return out;
  }
  if (!DOC_TYPES.has(docType)) {
    out.verdict = "needs_human";
    out.reasons.push({
      rule: "R5",
      detail: `알 수 없는 문서 종류: '${docType}'`,
      action: "자녀가 직접 확인",
    });
    return out;
  }
  // 분류 자체를 못 믿으면 사람에게 보낸다 (손글씨·비정형 문서)
  if (clsConf === "low") {
    out.verdict = "needs_human";
    out.reasons.push({
      rule: "R5",
      detail: `문서 종류를 확신하지 못함 (분류 신뢰도 ${out.classifyScore})`,
      action: "자녀가 직접 확인",
    });
    return out;
  }

  if (!st.extract) {
    // 미매핑 타입은 Extract 단계가 응답에서 통째로 빠진다(빈 결과가 아니다).
    if (EXTRACT_TYPES.has(docType)) {
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
      // 범주 밖 신뢰도는 기록만 하고 high 로 인정하지 않는다.
      conf[k] = v.confidence;
    }
  }

  // _value 를 단일 진실로 쓴다. text 쪽 숫자만 바꿔치기하는 우회를 막는다.
  const textFields = rawFields as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const [k, v] of Object.entries(textFields)) {
    if (!ALLOW_FIELDS.has(k)) continue;
    const a = av[k];
    if (a && typeof a === "object" && "_value" in a) {
      fields[k] = a._value;
      if (!sameValue(a._value, v)) conflicts.push(k);
    } else {
      fields[k] = v;
    }
  }
  for (const [k, a] of Object.entries(av)) {
    if (!ALLOW_FIELDS.has(k) || k in fields) continue;
    if (a && typeof a === "object" && "_value" in a) fields[k] = a._value;
  }
  const dropped = Object.keys(textFields)
    .filter((k) => !ALLOW_FIELDS.has(k))
    .sort();
  out.fields = fields;
  out.fieldConfidence = conf;
  if (dropped.length) out.droppedFields = dropped;

  // 값 자체가 말이 되는지 본다. 형식만 맞고 의미가 틀린 값은 결손으로 취급한다.
  const malformed: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (isBlank(v)) continue;
    // 객체·배열이 온 필드는 값이 있는데 읽을 수 없는 것이다.
    // 빈 값으로 뭉개면 "문서에 없음"이라고 잘못 말하게 된다.
    if (typeof v === "object") malformed.push(k);
    else if (DATE_FIELDS.has(k) && !isValidDate(v)) malformed.push(k);
    else if (AMOUNT_FIELDS.has(k) && !isValidAmount(v)) malformed.push(k);
  }

  // R3 — 신뢰도 게이트: 핵심 필드가 low 이거나 신뢰도가 없거나 값이 이상하면 숫자를 말하지 않는다.
  const usable = (k: string) => !isBlank(fields[k]) && !malformed.includes(k);
  const missing = (REQUIRED[docType] ?? []).filter((k) => !usable(k));
  const lowCore = CORE.filter((k) => !isBlank(fields[k]) && conf[k] !== "high");
  out.speechSuppressed =
    lowCore.length > 0 || missing.length > 0 || malformed.length > 0 || conflicts.length > 0;

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
  if (malformed.length) {
    out.reasons.push({
      rule: "R3",
      detail: `값 형식이 맞지 않음: ${malformed.join(", ")}`,
      action: "숫자 낭독 억제 + 자녀 확인",
    });
  }
  if (conflicts.length) {
    out.reasons.push({
      rule: "R3",
      detail: `추출 결과가 서로 다르게 적혀 있음: ${conflicts.join(", ")}`,
      action: "숫자 낭독 억제 + 자녀 확인",
    });
  }

  // R4 — 개인 휴대전화 상담번호 (레지스트리 등록 여부와 무관하게 본다)
  const phone = asText(fields.contact_phone);
  const tokens = phoneTokens(phone);
  const mobileHit = tokens.some((t) => MOBILE.test(t));
  const mobileStrong = mobileHit && conf.contact_phone === "high";
  if (mobileHit) {
    out.reasons.push({
      rule: "R4",
      detail: `고지서 상담 번호가 개인 휴대전화입니다: ${phone}`,
      action: "이 번호로 연락하지 말 것. 기관 공식 대표번호만 사용",
    });
  }

  // R1 — 발신 정합성
  const matched = matchIssuer(fields.issuer);
  if (!matched) {
    out.verdict = mobileStrong ? "mismatch" : "unknown_issuer";
    if (!mobileStrong) {
      out.reasons.push({
        rule: "R1",
        detail: `레지스트리에 없는 기관: ${asText(fields.issuer) || "(읽지 못함)"}`,
        action: "판단 불가 — 자녀 확인",
      });
    }
    if (tokens.length) {
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
  const issuer = matched.issuer;
  out.issuerId = issuer.issuer_id;

  // 꼬리 매칭은 구조만 본다. `포항지사`와 `가짜환급센터`를 구분하지 못하므로 clear 로 올리지 않는다.
  const branchOnly = matched.match === "branch";
  if (branchOnly) {
    out.reasons.push({
      rule: "R1",
      detail: `등록된 기관명이 아니라 하위 조직 표기입니다: ${asText(fields.issuer)}`,
      action: "자녀 확인 — 기관 공식 대표번호로 사실 확인 권장",
    });
  }

  let urlUnparseable = false;

  // 필드별 독립 판정. 한 필드가 비었거나 low 여도 다른 필드 대조는 계속한다.
  if (tokens.length) {
    const results = tokens.map((t) => phoneMatches(t, issuer));
    // 번호가 여러 개면 전부 공식 값이어야 한다. 하나라도 모르면 인정하지 않는다.
    const allOk = results.every((r) => r.ok);
    const viaPrefix = results.some((r) => r.viaPrefix);
    let ok: boolean | null = allOk;
    let note: string | undefined = allOk && viaPrefix ? "같은 국번 대역 — 부서 직통번호로 인정" : undefined;
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
      expected: issuer.official_phones.slice(),
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

  const url = asText(fields.info_url);
  if (url.trim()) {
    const h = normHost(url);
    if (!h) {
      out.checks.push({
        name: "안내 주소",
        value: url.slice(0, 60),
        ok: null,
        expected: null,
        note: "주소 형식을 해석할 수 없음",
        kind: "host",
      });
      out.reasons.push({
        rule: "R1",
        detail: `안내 주소를 해석할 수 없음: ${url.slice(0, 60)}`,
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

  if (tokens.length) {
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
  const payee = asText(fields.payee_name);
  if (payee.trim()) {
    const same = isOfficialPayee(payee, issuer);
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
  } else if (out.speechSuppressed || urlUnparseable || branchOnly) {
    out.verdict = "review";
  } else {
    // 'clear' 는 "확인된 불일치 없음"이다. '정상'·'진짜'·'안전'이 아니다.
    out.verdict = "clear";
  }

  // 배열은 복사해서 넘긴다. 호출자가 밀어 넣으면 전역 레지스트리가 오염된다.
  out.safeContact = {
    phones: issuer.official_phones.slice(),
    hosts: issuer.official_hosts.slice(),
    source: issuer.source_urls.slice(),
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
