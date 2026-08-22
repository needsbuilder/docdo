"use client";

import { useState } from "react";
import type { TraceStep, ActionResult } from "@/lib/store";
import { CheckCircle, WarningCircle, CaretRight } from "@/components/icons";

// 에이전트가 무엇을 했는지. 단계마다 시각·제목·(있으면) 화면. 끝나면 결과 한 줄.
// "알림"과 "처리"의 차이가 여기서 보인다.

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "대기 중", cls: "bg-well text-ink-mid" },
  running: { label: "처리 중", cls: "bg-brand-tint text-brand" },
  done: { label: "처리 완료", cls: "bg-ok-tint text-ok-ink" },
  blocked: { label: "사람 확인 필요", cls: "bg-warn-tint text-warn-ink" },
  failed: { label: "실패", cls: "bg-danger-tint text-danger-ink" },
};

function hhmm(t: string) {
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AgentTrace({ status, trace, result }: { status: string; trace: TraceStep[]; result: ActionResult | null }) {
  const [openShot, setOpenShot] = useState<number | null>(null);
  const st = STATUS[status] ?? STATUS.queued;
  const live = status === "queued" || status === "running";
  return (
    <section className="mt-4 rounded-inner bg-well p-4" aria-live={live ? "polite" : undefined}>
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-g-body font-bold text-ink">독도가 한 일</h3>
        <span className={`rounded-chip px-2 py-0.5 text-g-meta font-bold ${st.cls}`}>
          {st.label}
          {live && <span className="ml-1 inline-block animate-pulse">●</span>}
        </span>
      </header>
      <ol className="mt-3 space-y-2">
        {trace.map((s, i) => (
          <li key={i} className="grid grid-cols-[4.5em_1fr] gap-x-2 text-g-body">
            <span className="tabular-nums text-g-meta text-ink-soft">{hhmm(s.t)}</span>
            <div className="min-w-0">
              <p className="text-ink">{s.title}</p>
              {s.detail && <p className="break-all text-g-meta text-ink-soft">{s.detail}</p>}
              {s.shot && (
                <button
                  type="button"
                  onClick={() => setOpenShot(openShot === i ? null : i)}
                  className="mt-1 inline-flex items-center gap-1 text-g-meta font-bold text-brand"
                >
                  <CaretRight size={12} className={openShot === i ? "rotate-90" : ""} />
                  화면 {openShot === i ? "닫기" : "보기"}
                </button>
              )}
              {s.shot && openShot === i && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.shot} alt={`${s.title} 화면`} className="mt-2 w-full rounded-inner border border-line-soft" />
              )}
            </div>
          </li>
        ))}
      </ol>
      {result && (
        <p className={`mt-3 flex items-start gap-2 text-g-body font-bold ${status === "done" ? "text-ok-ink" : status === "failed" ? "text-danger-ink" : "text-warn-ink"}`}>
          {status === "done" ? <CheckCircle size={20} className="mt-0.5 shrink-0" /> : <WarningCircle size={20} className="mt-0.5 shrink-0" />}
          {result.summary}
        </p>
      )}
    </section>
  );
}
