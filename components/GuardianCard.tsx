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

// 보호자 카드 3단:
//   1단(항상) 판정 · 제목 · 핵심값 · D-day
//   2단(항상) 해야 할 일 — 여기가 "전달"과 "처리"의 차이다
//   3단(접힘) 근거 — 대조표·사유·복지·공식 연락처. 불일치일 때만 기본으로 펼친다.

// 판정은 점 + 글자 칩. 카드 왼쪽 띠는 둥근 모서리와 싸워서 뺐다.
const VERDICT_CHIP: Record<string, { dot: string; cls: string }> = {
  mismatch: { dot: "bg-danger", cls: "bg-danger-tint text-danger-ink" },
  review: { dot: "bg-warn", cls: "bg-warn-tint text-warn-ink" },
  clear: { dot: "bg-ok", cls: "bg-ok-tint text-ok-ink" },
};
const VERDICT_DEFAULT = { dot: "bg-line", cls: "bg-well text-ink-mid" };
const TODO_TONE = { danger: "text-danger-ink", warn: "text-warn-ink", normal: "text-ink" } as const;
const TODO_DOT = { danger: "bg-danger", warn: "bg-warn", normal: "bg-brand" } as const;

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
  // 승인 가능: 판정이 나왔고, 불일치가 아니고, 전자납부번호·금액을 확실히 읽었을 때만.
  const canApprove =
    !!r && d.verdict !== "mismatch" && conf2.epn === "high" && typeof f.epn === "string" && !!amount &&
    (d.action_status === "none" || d.action_status === "failed" || d.action_status === "blocked");
  const agentActive = d.action_status === "queued" || d.action_status === "running" || d.action_status === "waiting";

  return (
    <article className={`rounded-card border border-line-soft bg-surface p-5 shadow-card ${done ? "opacity-70" : ""}`}>
      {/* 1단 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {d.verdict && (
            <p className={`inline-flex items-center gap-1.5 rounded-chip px-2 py-0.5 text-g-meta font-bold ${(VERDICT_CHIP[d.verdict] ?? VERDICT_DEFAULT).cls}`}>
              <span className={`size-2 rounded-full ${(VERDICT_CHIP[d.verdict] ?? VERDICT_DEFAULT).dot}`} />
              {VERDICT_LABEL[d.verdict as Verdict]}
            </p>
          )}
          <h2 className="mt-2 text-g-title text-ink">{title}</h2>
          {r && (issuer || amount) && (
            <p className="mt-0.5 text-g-body text-ink-mid">{[issuer, amount].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        {due && dleft !== null && (
          <p className={`shrink-0 rounded-chip px-2.5 py-1 text-g-meta font-bold tabular-nums ${dleft < 0 ? "bg-danger-tint text-danger-ink" : dleft <= 3 ? "bg-warn-tint text-warn-ink" : "bg-well text-ink-mid"}`}>
            {ddayLabel(dleft)}
          </p>
        )}
      </div>

      {/* 2단 */}
      {todos.length > 0 && !done && (
        <ul className="mt-4 space-y-2">
          {todos.map((t, i) => (
            <li key={i} className={`flex gap-2.5 text-g-body ${TODO_TONE[t.tone]}`}>
              <span className={`mt-[0.55em] size-2 shrink-0 rounded-full ${TODO_DOT[t.tone]}`} />
              {t.text}
            </li>
          ))}
        </ul>
      )}
      {benefits.length > 0 && !open && (
        <p className="mt-2 text-g-meta text-brand">{benefits.map((b) => b.name).join(" · ")} 대상일 수 있음 — 근거에서 확인</p>
      )}

      {/* 3단 */}
      {r && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="press mt-4 -ml-1 inline-flex min-h-tap items-center gap-1 rounded-inner px-1 text-g-body font-bold text-ink-mid active:bg-brand-tint"
          >
            <CaretRight size={16} className={`transition-transform ${open ? "rotate-90" : ""}`} />
            근거 {open ? "접기" : "보기"}
            <span className="font-normal text-ink-soft">
              · 공식 정보 대조 {r.checksPassed ?? 0}/{r.checksTotal ?? 0}
            </span>
          </button>
          {open && (
            <div className="mt-3 space-y-4 border-t border-line-soft pt-4">
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
                    <a href={`tel:${officialPhone}`} className="press inline-flex min-h-tap items-center gap-2 rounded-control border-2 border-line bg-surface px-3 text-g-body font-bold text-ink active:bg-brand-tint">
                      <Phone size={20} />
                      공식 대표번호 {officialPhone}
                    </a>
                  )}
                  {officialHost && (
                    <a href={`https://${officialHost}`} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-tap items-center gap-2 rounded-control border-2 border-line bg-surface px-3 text-g-body text-ink active:bg-brand-tint">
                      <ArrowSquareOut size={18} />
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
        <div className="mt-5 flex flex-wrap gap-2">
          {canApprove && !confirm && (
            <>
              <button
                type="button"
                onClick={() => onApprove(d.id, "demo")}
                className="press on-brand min-h-tap rounded-control bg-brand px-4 text-g-body font-bold text-surface active:bg-brand-deep"
              >
                {d.action_status === "none" ? `납부 처리 승인 · ${amount}` : "다시 처리 승인"}
              </button>
              {/* 실제 인터넷지로. 합성 고지서라 조회는 안 되고, 인증서 단계에서 보호자에게 넘어오는 것까지 보여준다. */}
              <button
                type="button"
                onClick={() => onApprove(d.id, "giro")}
                className="press min-h-tap rounded-control border-2 border-line bg-surface px-4 text-g-body text-ink active:bg-brand-tint"
              >
                실제 인터넷지로에서
              </button>
            </>
          )}
          {agentActive && d.action_status !== "waiting" && (
            <span className="flex min-h-tap items-center text-g-body text-ink-mid">독도가 처리 중입니다…</span>
          )}
          {/* 에이전트 없이 사람이 직접 처리한 경우만. 승인이 곧 확인이므로 별도 '확인함'은 없다. */}
          {!agentActive && !done && (
            confirm ? (
              <>
                <span className="flex min-h-tap items-center text-g-body text-ink">직접 처리하셨나요? 부모님 화면도 바뀝니다.</span>
                <button type="button" onClick={() => { setConfirm(false); onMark(d.id, "done"); }} className="press on-brand min-h-tap rounded-control bg-brand px-4 text-g-body font-bold text-surface active:bg-brand-deep">
                  네, 처리했어요
                </button>
                <button type="button" onClick={() => setConfirm(false)} className="press min-h-tap rounded-control border-2 border-line bg-surface px-4 text-g-body text-ink active:bg-brand-tint">
                  취소
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                className="press min-h-tap rounded-control border-2 border-line bg-surface px-4 text-g-body font-bold text-ink active:bg-brand-tint"
              >
                직접 처리했어요
              </button>
            )
          )}
          {done && d.action_status !== "done" && (
            <span className="flex min-h-tap items-center rounded-control bg-ok-tint px-4 text-g-body font-bold text-ok-ink">직접 처리함</span>
          )}
        </div>
      )}
    </article>
  );
}
