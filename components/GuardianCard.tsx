"use client";

import { useState } from "react";
import { VERDICT_LABEL } from "@/lib/verify";
import type { Verdict } from "@/lib/types";
import type { GuardianDoc } from "@/lib/dto";
import { buildTodos, parseISODate, daysLeft, ddayLabel } from "@/lib/todo";
import { findRelatedBenefits } from "@/lib/welfare";
import CheckList from "@/components/CheckList";
import BenefitHints from "@/components/BenefitHints";
import { Phone, ArrowSquareOut, CaretRight } from "@/components/icons";
import AgentTrace from "@/components/AgentTrace";

// 보호자 카드 — 장식 없이 글자와 여백으로.
//   1단 판정 한 줄(점 + 글자) · D-day
//   2단 제목 · 금액이 주인공(큰 숫자) · 기한·보낸 곳은 같은 줄의 보조
//   3단 해야 할 일 — 여기가 "전달"과 "처리"의 차이다
//   4단(접힘) 근거 — 대조표·사유·복지·공식 연락처. 불일치일 때만 기본으로 펼친다.
// 안전: 승인 버튼은 판정이 나왔고 불일치가 아니고 전자납부번호·금액이 high 일 때만. 순서를 바꾸지 않는다.

const VERDICT_TONE: Record<string, { dot: string; text: string }> = {
  mismatch: { dot: "bg-danger", text: "text-danger-ink" },
  review: { dot: "bg-warn", text: "text-warn-ink" },
  clear: { dot: "bg-ok", text: "text-ok-ink" },
};
const VERDICT_DEFAULT = { dot: "bg-ink-soft", text: "text-ink-mid" };
const TODO_TONE = { danger: "text-danger-ink", warn: "text-warn-ink", normal: "text-ink" } as const;

function money(v: unknown): string | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? `${v.toLocaleString("ko-KR")}원` : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/원$/, "");
  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(s)) return null;
  return `${Number(s.replace(/,/g, "")).toLocaleString("ko-KR")}원`;
}
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export default function GuardianCard({
  doc: d,
  onMark,
  onApprove,
  onInput,
}: {
  doc: GuardianDoc;
  onMark: (id: string, resolution: "acknowledged" | "done") => void;
  onApprove: (id: string, site?: "demo" | "giro") => void;
  onInput: (id: string, input: Record<string, unknown>) => void;
}) {
  const r = d.result;
  const [open, setOpen] = useState(r?.verdict === "mismatch");
  const [confirm, setConfirm] = useState(false);

  const f = (r?.fields ?? {}) as Record<string, unknown>;
  const conf = r?.fieldConfidence ?? {};
  const amount = conf.amount_krw === "high" ? money(f.amount_krw) : null;
  const issuer = text(f.issuer);
  const dueRaw = conf.due_date === "high" ? f.due_date : conf.apply_deadline === "high" ? f.apply_deadline : null;
  const due = parseISODate(dueRaw);
  const dleft = due ? daysLeft(due) : null;
  const title = d.phrases?.docLabel ?? (r ? "우편물" : d.pipeline_status === "failed" ? "처리 실패" : "읽는 중…");
  const todos = r ? buildTodos(r) : [];
  const benefits = r ? findRelatedBenefits(r) : [];
  const officialPhone = r?.safeContact?.phones?.[0];
  const officialHost = r?.safeContact?.hosts?.[0];
  const done = d.resolution_status === "done";
  const conf2 = r?.fieldConfidence ?? {};
  const suspected = (r?.reasons ?? []).some((x) => x.rule === "R7");
  const epnOk = conf2.epn === "high" && typeof f.epn === "string";
  const idle = d.action_status === "none" || d.action_status === "failed" || d.action_status === "blocked";
  const canApprove = !!r && d.verdict !== "mismatch" && !suspected && epnOk && !!amount && idle;
  // 승인이 막힌 이유를 한 줄 사실로.
  const lockReason =
    r && !canApprove && !done && idle
      ? d.verdict === "mismatch" || suspected
        ? "공식 정보와 다른 항목이 있어 납부 처리를 열지 않아요"
        : !epnOk || !amount
          ? "전자납부번호와 금액을 확실히 읽은 문서만 납부 처리할 수 있어요"
          : null
      : null;
  const agentActive = d.action_status === "queued" || d.action_status === "running" || d.action_status === "waiting";
  const tone = VERDICT_TONE[d.verdict ?? ""] ?? VERDICT_DEFAULT;
  const dtone = dleft === null ? "" : dleft < 0 ? "text-danger-ink" : dleft <= 3 ? "text-warn-ink" : "text-ink-soft";

  return (
    <article className={`rounded-card bg-surface px-5 pb-5 pt-4 ${done ? "opacity-60" : ""}`}>
      {/* 1단 — 판정 한 줄 · D-day */}
      <div className="flex items-center justify-between gap-3 text-g-meta">
        {d.verdict ? (
          <p className={`inline-flex items-center gap-1.5 font-bold ${tone.text}`}>
            <span className={`size-1.5 rounded-full ${tone.dot}`} />
            {VERDICT_LABEL[d.verdict as Verdict]}
          </p>
        ) : (
          <p className="text-ink-soft">{d.pipeline_status === "failed" ? "처리 실패" : "읽는 중"}</p>
        )}
        {due && dleft !== null && <p className={`font-bold tabular-nums ${dtone}`}>{ddayLabel(dleft)}</p>}
      </div>

      {/* 2단 — 제목 · 금액 */}
      <h2 className="mt-2 text-[1.375rem] font-bold leading-snug tracking-[-0.01em] text-ink">{title}</h2>
      {r && (amount || due || issuer) && (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {amount && <span className="text-[1.75rem] font-bold tabular-nums tracking-[-0.01em] text-ink">{amount}</span>}
          {due && <span className="text-g-body text-ink-mid">{due.getMonth() + 1}월 {due.getDate()}일까지</span>}
          {issuer && <span className="text-g-meta text-ink-soft">{issuer}</span>}
        </p>
      )}

      {/* 3단 — 해야 할 일 */}
      {todos.length > 0 && !done && (
        <ul className="mt-4 border-t border-line-soft pt-3">
          {todos.map((t, i) => (
            <li key={i} className={`flex gap-2 py-1 text-g-body leading-snug ${TODO_TONE[t.tone]}`}>
              <span className="select-none text-ink-soft">—</span>
              <span className="min-w-0">{t.text}</span>
            </li>
          ))}
        </ul>
      )}
      {benefits.length > 0 && !open && (
        <p className="mt-2 text-g-meta text-ink-soft">
          {benefits.map((b) => b.name).join(" · ")} 대상일 수 있음 · <span className="text-ink-mid">근거에서 확인</span>
        </p>
      )}

      {/* 4단 — 근거 */}
      {r && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="press mt-3 -ml-1 inline-flex min-h-tap items-center gap-1 rounded-inner px-1 text-g-meta font-bold text-ink-mid active:bg-well"
          >
            <CaretRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
            근거 {open ? "접기" : "보기"}
            <span className="font-normal text-ink-soft">
              · 공식 정보 대조 {r.checksPassed ?? 0}/{r.checksTotal ?? 0}
            </span>
          </button>
          {open && (
            <div className="mt-2 space-y-4 border-t border-line-soft pt-4">
              <CheckList result={r} />
              {r.reasons?.length > 0 && (
                <ul className="space-y-1.5 text-g-body">
                  {r.reasons.map((x, i) => (
                    <li key={i} className={x.rule === "R3" || x.rule === "R5" ? "text-ink-mid" : "text-danger-ink"}>
                      {x.detail}
                      <span className="text-ink-soft"> → {x.action}</span>
                    </li>
                  ))}
                </ul>
              )}
              <BenefitHints result={r} />
              {(officialPhone || officialHost) && (
                <div className="flex flex-wrap gap-2">
                  {officialPhone && (
                    <a href={`tel:${officialPhone}`} className="press inline-flex min-h-tap items-center gap-2 rounded-control bg-well px-4 text-g-body font-bold text-ink active:bg-brand-tint">
                      <Phone size={18} />
                      공식 대표번호 {officialPhone}
                    </a>
                  )}
                  {officialHost && (
                    <a href={`https://${officialHost}`} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-tap items-center gap-2 rounded-control bg-well px-4 text-g-body text-ink active:bg-brand-tint">
                      <ArrowSquareOut size={16} />
                      공식 사이트
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 에이전트 */}
      {d.action_status !== "none" && <AgentTrace status={d.action_status} trace={d.action_trace ?? []} result={d.action_result} live={d.action_live} wait={d.action_wait} onInput={(input) => onInput(d.id, input)} />}

      {/* 행동 */}
      {r && (
        <div className="mt-4 flex flex-col gap-2">
          {lockReason && <p className="text-g-meta text-ink-soft">{lockReason}</p>}
          {canApprove && !confirm && (
            <>
              <button
                type="button"
                onClick={() => onApprove(d.id, "demo")}
                className="press on-brand min-h-cta rounded-control bg-ink px-4 text-g-title text-surface active:bg-ink-mid"
              >
                {d.action_status === "none" ? `납부 처리 승인 · ${amount}` : "다시 처리 승인"}
              </button>
              {/* 실제 인터넷지로. 합성 고지서라 조회는 안 되고, 인증서 단계에서 보호자에게 넘어오는 것까지 보여준다. */}
              <button
                type="button"
                onClick={() => onApprove(d.id, "giro")}
                className="press min-h-tap rounded-control px-4 text-g-body font-bold text-ink-mid active:bg-well"
              >
                실제 인터넷지로에서
              </button>
            </>
          )}
          {agentActive && d.action_status !== "waiting" && (
            <span className="flex min-h-tap items-center justify-center text-g-meta text-ink-soft">독도가 처리 중입니다…</span>
          )}
          {/* 에이전트 없이 사람이 직접 처리한 경우만. 승인이 곧 확인이므로 별도 '확인함'은 없다. */}
          {!agentActive && !done && (
            confirm ? (
              <>
                <span className="flex min-h-tap items-center text-g-body text-ink">직접 처리하셨나요? 부모님 화면도 바뀝니다.</span>
                <button type="button" onClick={() => { setConfirm(false); onMark(d.id, "done"); }} className="press on-brand min-h-cta rounded-control bg-ink px-4 text-g-title text-surface active:bg-ink-mid">
                  네, 처리했어요
                </button>
                <button type="button" onClick={() => setConfirm(false)} className="press min-h-tap rounded-control px-4 text-g-body font-bold text-ink-mid active:bg-well">
                  취소
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                className={`press rounded-control px-4 text-g-body font-bold active:bg-well ${canApprove ? "min-h-tap text-ink-soft" : "min-h-cta border border-line-soft text-ink"}`}
              >
                직접 처리했어요
              </button>
            )
          )}
          {done && d.action_status !== "done" && <span className="flex min-h-tap items-center text-g-meta font-bold text-ok-ink">직접 처리함</span>}
        </div>
      )}
    </article>
  );
}
