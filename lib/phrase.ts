import type { VerifyResult } from "./types";

// 화면용과 음성용을 따로 만든다.
// 화면은 "3만 2천원"(눈으로 읽는 형태), 음성은 "삼만 이천 원"(TTS 가 자릿수로 읽지 않게).
//
// 원칙 2 — 확신하지 못한 값은 숫자를 말하지 않는다.
// 원칙 3 — 지시하지 않는다. "내시면 됩니다" ✗ → "문서에 적힌 금액은 …입니다" ✓
// 원칙 4 — 확률적 판단으로 폐기를 지시하지 않는다.

const D = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL = ["", "십", "백", "천"];
const BIG = ["", "만", "억", "조"];

export function koNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "영";
  const groups: string[] = [];
  let rest = Math.floor(Math.abs(n));
  let gi = 0;
  while (rest > 0 && gi < BIG.length) {
    const g = rest % 10000;
    if (g > 0) {
      const ds = String(g).split("").map(Number);
      let s = "";
      ds.forEach((d, i) => {
        const pos = ds.length - 1 - i;
        if (d === 0) return;
        // 천/백/십 자리의 1은 읽지 않는다. "일천"이 아니라 "천".
        s += (d === 1 && pos > 0 ? "" : D[d]) + SMALL[pos];
      });
      groups.unshift(s + BIG[gi]);
    }
    rest = Math.floor(rest / 10000);
    gi++;
  }
  return groups.join(" ");
}

export const koMoney = (n: number) => `${koNumber(n)} 원`;

/** 실제 달력 날짜만 읽는다. `2026-99-99` 를 통과시키면 "구십구월 구십구일"을 낭독한다. */
function isoParts(iso: unknown): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return [y, mo, d];
}

export function koDate(iso: unknown): string {
  const p = isoParts(iso);
  return p ? `${koNumber(p[1])}월 ${koNumber(p[2])}일` : "";
}

/** 전화번호는 자릿수로 읽는다. TTS 가 "1577"을 "천오백칠십칠"로 읽으면 못 알아듣는다. */
export const koPhone = (p: unknown) =>
  String(p ?? "")
    .split("-")
    .map((part) =>
      part
        .split("")
        .map((c) => (c === "0" ? "공" : (D[Number(c)] ?? c)))
        .join(""),
    )
    .join(" ");

/** Extract 가 숫자를 문자열로 줄 때가 있다. "32,000" · "32000원" 도 금액으로 읽는다. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^[0-9][0-9,]*원?$/.test(s)) return null;
  const digits = s.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** 화면용 금액. 만 단위로 끊어야 큰 글씨에서 자릿수를 셀 일이 없다. */
function money(n: number): string {
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  if (man === 0) return `${n.toLocaleString("ko-KR")}원`;
  if (rest === 0) return `${man.toLocaleString("ko-KR")}만원`;
  if (rest % 1000 === 0) return `${man.toLocaleString("ko-KR")}만 ${rest / 1000}천원`;
  return `${man.toLocaleString("ko-KR")}만 ${rest.toLocaleString("ko-KR")}원`;
}

function shortDate(iso: unknown): string {
  const p = isoParts(iso);
  return p ? `${p[1]}월 ${p[2]}일` : "";
}

const LABELS: [RegExp, string][] = [
  [/건강보험/, "건강보험료"],
  [/장기요양/, "장기요양보험료"],
  [/전기/, "전기요금"],
  [/가스/, "가스요금"],
  [/주민세/, "주민세"],
  [/지방세|체납/, "지방세"],
  [/통신|이동전화/, "통신요금"],
  [/기초연금/, "기초연금"],
  [/에너지바우처/, "에너지바우처"],
];

/** 어르신 화면에는 **문서에서 읽은 원문을 그대로 띄우지 않는다.**
 *  등록된 라벨로만 바꾼다. doc_title 이 "계좌110-555 송금" 이어도 화면에는 "우편물"이 뜬다.
 *  원문이 필요한 쪽은 자녀 화면이다(fields.doc_title 을 직접 읽는다). */
export function shortLabel(title: unknown): string {
  const t = String(title ?? "").trim();
  for (const [re, label] of LABELS) if (re.test(t)) return label;
  return "우편물";
}

/** 무엇이 어긋났는지 종류별로 사실만 말한다.
 *  예금주 불일치인데 "연락처가 달라요"라고 하면 확인된 사실을 잘못 전달하는 것이다. */
function mismatchWording(r: VerifyResult): { screenLines: string[]; what: string } {
  const kinds = new Set(r.checks.filter((c) => c.ok === false).map((c) => c.kind));
  // 여러 개가 어긋났으면 어르신이 가장 알아듣기 쉬운 것부터 말한다.
  // 공공기관은 010 번호를 쓰지 않는다 — 이게 가장 구체적이고 즉시 이해된다.
  if (kinds.has("mobile")) {
    return {
      screenLines: ["이 문서에 적힌 상담 번호가", "개인 휴대전화입니다"],
      what: "이 종이에 적힌 상담 번호가 개인 휴대전화예요",
    };
  }
  if (kinds.has("payee")) {
    return {
      screenLines: ["이 문서에 적힌 예금주가", "발급기관 이름과 다릅니다"],
      what: "이 종이에 적힌 예금주가 기관 이름과 달라요",
    };
  }
  if (kinds.has("host")) {
    return {
      screenLines: ["이 문서에 적힌 인터넷 주소가", "공식 주소와 다릅니다"],
      what: "이 종이에 적힌 인터넷 주소가 공식 주소와 달라요",
    };
  }
  return {
    screenLines: ["이 문서의 정보가", "공식 정보와 다릅니다"],
    what: "이 종이에 적힌 정보가 공식 정보와 달라요",
  };
}

export type Phrases = { docLabel: string; screenLines: string[]; speech: string };

export function buildPhrases(r: VerifyResult): Phrases {
  const f = r.fields ?? {};
  const docLabel = shortLabel(f.doc_title);
  // "우편물 우편물이에요" 가 되지 않게 기본 라벨일 때는 한 번만 쓴다.
  const subject = docLabel === "우편물" ? "우편물" : `${docLabel} 우편물`;
  // 숫자마다 해당 필드 신뢰도를 다시 본다. verify 가 억제했더라도 여기서 한 번 더 잠근다.
  const conf = r.fieldConfidence ?? {};
  const amount = conf.amount_krw === "high" ? parseAmount(f.amount_krw) : null;
  // due_date 가 빈 문자열이면 apply_deadline 을 가리지 않게 유효한 첫 값을 쓴다.
  const dueRaw = [
    conf.due_date === "high" ? f.due_date : null,
    conf.apply_deadline === "high" ? f.apply_deadline : null,
  ]
    .map((v) => String(v ?? ""))
    .find((v) => isoParts(v)) ?? "";
  const due = dueRaw;

  // 원칙 5 — 문서의 번호로 전화하지 말라고 알린다. 공식 번호는 화면이 레지스트리에서 가져온다.
  // 설계서 §5.2 가 승인한 문구다. 보호 경고이지 납부 지시가 아니다.
  if (r.verdict === "mismatch") {
    const m = mismatchWording(r);
    return {
      docLabel,
      screenLines: m.screenLines,
      speech:
        `어르신, 잠깐만요. ${m.what}. ` +
        "여기 적힌 번호로는 전화하지 마세요. 자녀분께 먼저 여쭤보세요.",
    };
  }

  if (r.verdict === "needs_human" || r.verdict === "unknown_issuer") {
    return {
      docLabel,
      screenLines: ["자녀분께 확인을", "부탁드렸어요"],
      speech: "어르신, 이 문서는 제가 확실하게 읽지 못했어요. 자녀분께 확인을 부탁드렸어요.",
    };
  }

  if (r.verdict === "failed") {
    return {
      docLabel,
      screenLines: ["이 사진을 처리하지 못했어요", "다시 찍어 주세요"],
      speech: "어르신, 이 사진을 처리하지 못했어요. 밝은 곳에서 다시 한 번 찍어 주세요.",
    };
  }

  // 의도적 미매핑 타입(광고 등). 폐기를 지시하지 않는다 — 자녀 목록에는 그대로 남는다.
  // "급하지 않다"고도 말하지 않는다. 분류는 확률적이다 — 단전 통지서가 광고로 오면 방치가 된다.
  if (r.verdict === "no_extract") {
    return {
      docLabel,
      screenLines: ["자동으로 읽는 문서가 아니에요", "자녀분께 보내드렸어요"],
      speech: `어르신, ${subject}이에요. 자동으로 읽는 종류의 문서가 아니라서 내용은 확인하지 못했어요. 자녀분께 보내드렸어요.`,
    };
  }

  // 원칙 2 — low 이거나 결손이면 숫자를 말하지 않는다.
  // speechSuppressed 가 **명시적으로 false** 일 때만 숫자를 읽는다. 없으면 억제다.
  if (r.speechSuppressed !== false) {
    return {
      docLabel,
      screenLines: ["정확히 읽지 못했어요", "자녀분께 확인을 부탁드렸어요"],
      speech: `어르신, ${docLabel} 관련 우편물이에요. 내용을 정확히 읽지 못해서 자녀분께 확인을 부탁드렸어요.`,
    };
  }

  const screenLines: string[] = [];
  const spoken: string[] = [`어르신, ${subject}이에요.`];
  if (due) screenLines.push(`${shortDate(due)}까지`);
  if (amount !== null) screenLines.push(money(amount));

  if (amount !== null && due) {
    spoken.push(`문서에 적힌 금액은 ${koMoney(amount)}이고, 기한은 ${koDate(due)}입니다.`);
  } else if (amount !== null) {
    spoken.push(`문서에 적힌 금액은 ${koMoney(amount)}입니다.`);
  } else if (due) {
    spoken.push(`기한은 ${koDate(due)}입니다.`);
  }

  // review·not_checkable 은 사실만 덧붙인다. 무엇을 하라고 말하지 않는다.
  if (r.verdict === "review" || r.verdict === "not_checkable") {
    spoken.push("확인이 필요한 부분이 있어 자녀분께 함께 보내드렸어요.");
    screenLines.push("확인이 필요한 부분이 있어요");
  } else {
    spoken.push("자녀분께 보내드렸어요.");
  }

  if (!screenLines.length) screenLines.push("자녀분께 보내드렸어요");
  return { docLabel, screenLines, speech: spoken.join(" ") };
}
