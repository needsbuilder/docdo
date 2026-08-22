import type { VerifyResult } from "./types";

// 보호자의 "해야 할 일". 판정·필드·레지스트리에서만 만든다 — 새 API 호출 없음.
// 어르신 화면과 달리 보호자에게는 지시해도 된다. 단, 근거 없는 일은 만들지 않는다.

export type Todo = { text: string; tone: "danger" | "warn" | "normal" };

export function parseISODate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})[-.\/]?(\d{1,2})[-.\/]?(\d{1,2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** 오늘 기준 남은 날. 0 = 오늘, 음수 = 지남. */
export function daysLeft(due: Date, today = new Date()): number {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - t) / 86_400_000);
}

export function ddayLabel(n: number): string {
  if (n === 0) return "오늘까지";
  if (n < 0) return `${-n}일 지남`;
  return `D-${n}`;
}

function shortDate(d: Date): string {
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

export function buildTodos(r: VerifyResult, today = new Date()): Todo[] {
  const f = r.fields ?? {};
  const conf = r.fieldConfidence ?? {};
  const phone = r.safeContact?.phones?.[0];
  const out: Todo[] = [];

  if (r.verdict === "mismatch") {
    out.push({ text: "부모님께 전화해서 이 우편물의 번호·계좌로 연락하거나 입금하지 마시라고 말씀드리기", tone: "danger" });
    if (phone) out.push({ text: `공식 번호 ${phone}로 이 우편물이 실제 발송된 것인지 확인`, tone: "danger" });
    return out;
  }

  const due = parseISODate(conf.due_date === "high" ? f.due_date : null);
  const apply = parseISODate(conf.apply_deadline === "high" ? f.apply_deadline : null);
  const amountOk = conf.amount_krw === "high" && f.amount_krw != null && f.amount_krw !== "";

  if (due) {
    const n = daysLeft(due, today);
    const tone = n < 0 ? "danger" : n <= 3 ? "warn" : "normal";
    out.push({
      text: `${shortDate(due)}까지 ${amountOk ? "납부됐는지" : "처리됐는지"} 확인 (${ddayLabel(n)})`,
      tone,
    });
  } else if (apply) {
    const n = daysLeft(apply, today);
    out.push({ text: `${shortDate(apply)}까지 신청 여부 결정 (${ddayLabel(n)})`, tone: n <= 3 ? "warn" : "normal" });
  }

  if (r.verdict === "review" || r.verdict === "not_checkable" || r.verdict === "unknown_issuer" || r.verdict === "needs_human") {
    out.push({
      text: phone ? `공식 번호 ${phone}로 이 우편물이 실제 발송된 것인지 확인` : "발송 기관에 직접 연락해 실제 발송된 우편물인지 확인",
      tone: "warn",
    });
  }

  if (!out.length && r.verdict === "clear") {
    out.push({ text: "부모님께 내용 전해드리기 — 따로 급한 일은 없습니다", tone: "normal" });
  }
  return out;
}
