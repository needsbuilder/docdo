"use client";

import { useRef, useState } from "react";
import type { TraceStep, ActionResult, ActionWait } from "@/lib/store";
import { CheckCircle, WarningCircle, CaretRight } from "@/components/icons";

// 에이전트가 무엇을 했는지. 단계마다 시각·제목·(있으면) 화면. 끝나면 결과 한 줄.
// waiting 이면 보호자가 실시간 화면을 직접 터치·입력해 그 단계를 넘기고 [이어서 하기]를 누른다.
// 이 경로로 들어온 입력은 서버 큐를 거쳐 워커가 0.5초 안에 꺼내 쓰고 지운다. 끝나면 큐를 비운다. 보호자 응답에도 싣지 않는다.

const FRAME_W = 900;
const FRAME_H = 640;

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "대기 중", cls: "bg-well text-ink-mid" },
  running: { label: "처리 중", cls: "bg-brand-tint text-brand" },
  waiting: { label: "보호자 차례", cls: "bg-warn-tint text-warn-ink" },
  done: { label: "처리 완료", cls: "bg-ok-tint text-ok-ink" },
  blocked: { label: "사람 확인 필요", cls: "bg-warn-tint text-warn-ink" },
  failed: { label: "실패", cls: "bg-danger-tint text-danger-ink" },
};

function hhmm(t: string) {
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AgentTrace({
  status,
  trace,
  result,
  live,
  wait,
  onInput,
}: {
  status: string;
  trace: TraceStep[];
  result: ActionResult | null;
  live?: string | null;
  wait?: ActionWait | null;
  onInput?: (input: Record<string, unknown>) => void;
}) {
  const [openShot, setOpenShot] = useState<number | null>(null);
  const [text, setText] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);
  const st = STATUS[status] ?? STATUS.queued;
  const active = status === "queued" || status === "running" || status === "waiting";
  const waiting = status === "waiting";
  const remote = waiting && wait?.mode === "remote";

  function tap(e: React.MouseEvent<HTMLImageElement>) {
    if (!remote || !onInput || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * FRAME_W;
    const y = ((e.clientY - r.top) / r.height) * FRAME_H;
    onInput({ kind: "tap", x, y });
  }

  return (
    <section className="mt-4 rounded-inner bg-well p-4" aria-live={active ? "polite" : undefined}>
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-g-body font-bold text-ink">독도가 한 일</h3>
        <span className={`rounded-chip px-2 py-0.5 text-g-meta font-bold ${st.cls}`}>
          {st.label}
          {active && !waiting && <span className="ml-1 inline-block animate-pulse">●</span>}
        </span>
      </header>

      {waiting && wait && (
        <div className="mt-3 rounded-inner border-2 border-warn bg-warn-tint p-3">
          <p className="text-g-body font-bold text-warn-ink">{wait.reason}</p>
          <p className="mt-1 text-g-body text-ink-mid">{wait.hint}</p>
        </div>
      )}

      {live && (status === "running" || waiting) && (
        <figure className="relative mt-3 overflow-hidden rounded-inner border border-line-soft bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={live}
            alt="독도가 지금 보고 있는 화면"
            onClick={tap}
            className={`block w-full ${remote ? "cursor-crosshair" : ""}`}
            draggable={false}
          />
          <figcaption
            className={`absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-chip px-2 py-0.5 text-g-meta font-bold text-surface ${remote ? "bg-warn" : "bg-danger"}`}
          >
            <span className="size-2 animate-pulse rounded-full bg-surface" />
            {remote ? "화면을 눌러 직접 조작" : "실시간"}
          </figcaption>
        </figure>
      )}

      {remote && onInput && (
        <div className="mt-2 flex flex-col gap-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text) return;
              onInput({ kind: "type", text });
              setText("");
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="입력할 글자 (처리 즉시 삭제)"
              autoComplete="off"
              className="min-h-tap min-w-0 flex-1 rounded-control border-2 border-line bg-surface px-3 text-g-body text-ink"
            />
            <button type="submit" className="press min-h-tap rounded-control border-2 border-line bg-surface px-3 text-g-body font-bold text-ink active:bg-brand-tint">
              입력
            </button>
            <button type="button" onClick={() => onInput({ kind: "key", key: "Enter" })} className="press min-h-tap rounded-control border-2 border-line bg-surface px-3 text-g-body text-ink active:bg-brand-tint">
              Enter
            </button>
          </form>
        </div>
      )}

      {waiting && onInput && (
        <button
          type="button"
          onClick={() => onInput({ kind: "resume" })}
          className="press on-brand mt-3 min-h-tap w-full rounded-control bg-brand px-4 text-g-body font-bold text-surface active:bg-brand-deep"
        >
          {wait?.mode === "confirm" ? "인증했어요 · 이어서 하기" : "이 단계 끝났어요 · 이어서 하기"}
        </button>
      )}

      <ol className="mt-3 space-y-2">
        {trace.map((s, i) => (
          <li key={i} className="grid grid-cols-[4.5em_1fr] gap-x-2 text-g-body">
            <span className="tabular-nums text-g-meta text-ink-soft">{hhmm(s.t)}</span>
            <div className="min-w-0">
              <p className="text-ink">{s.title}</p>
              {s.detail && <p className="break-all text-g-meta text-ink-soft">{s.detail}</p>}
              {s.shot && (
                <button type="button" onClick={() => setOpenShot(openShot === i ? null : i)} className="mt-1 inline-flex items-center gap-1 text-g-meta font-bold text-brand">
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
