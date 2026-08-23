"use client";

import { useRef, useState } from "react";
import type { TraceStep, ActionResult, ActionWait } from "@/lib/store";
import { CheckCircle, WarningCircle, CaretRight } from "@/components/icons";

// 에이전트가 무엇을 했는지 — 폰 카드 한 장 안에서 읽히게 **짧게**.
//   진행 중: 상태 칩 + 현재 단계 한 줄 + 실시간 화면
//   보호자 차례: 이유 한 줄 + 실시간 화면(직접 터치) + [이어서 하기]
//   끝: 상태 칩 + 결과 한 줄
// 전체 과정·스크린샷·글자 입력은 접어 둔다. 보호자가 로그를 읽을 이유가 없다.
// 원격 입력은 서버 큐를 거쳐 워커가 0.5초 안에 꺼내 쓰고 지운다. 끝나면 큐를 비운다.

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "대기 중", cls: "bg-well text-ink-mid" },
  running: { label: "처리 중", cls: "bg-brand-tint text-brand-deep" },
  waiting: { label: "보호자 차례", cls: "bg-warn-tint text-warn-ink" },
  done: { label: "처리 완료", cls: "bg-ok-tint text-ok-ink" },
  blocked: { label: "확인 필요", cls: "bg-warn-tint text-warn-ink" },
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
  const [showSteps, setShowSteps] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  // 방금 누른 자리. 워커가 클릭을 반영한 화면이 오기까지 1~2초 걸리므로 즉시 점을 찍어 준다.
  const [tapMark, setTapMark] = useState<{ x: number; y: number } | null>(null);
  const last = trace[trace.length - 1];
  const imgRef = useRef<HTMLImageElement>(null);
  const st = STATUS[status] ?? STATUS.queued;
  const active = status === "queued" || status === "running" || status === "waiting";
  const waiting = status === "waiting";
  const remote = waiting && wait?.mode === "remote";

  function tap(e: React.PointerEvent<HTMLElement>) {
    if (!remote || !onInput || !imgRef.current) return;
    e.preventDefault();
    const r = imgRef.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    if (px < 0 || px > 1 || py < 0 || py > 1) return;
    setTapMark({ x: px * 100, y: py * 100 });
    setTimeout(() => setTapMark(null), 900);
    // 워커 브라우저 좌표 = JPEG 실제 크기(deviceScaleFactor 1). 프레임 크기를 여기 박아 두지 않는다.
    const img = imgRef.current;
    onInput({ kind: "tap", x: px * img.naturalWidth, y: py * img.naturalHeight });
  }

  return (
    <section className="mt-4 rounded-inner bg-paper p-3" aria-live={active ? "polite" : undefined}>
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-g-body font-bold text-ink">독도가 한 일</h3>
        <span className={`rounded-chip px-2.5 py-0.5 text-g-meta font-bold ${st.cls}`}>
          {st.label}
          {active && !waiting && <span className="ml-1 inline-block animate-pulse">●</span>}
        </span>
      </header>

      {/* 진행 중엔 현재 단계 한 줄만 */}
      {active && !waiting && last && (
        <p className="mt-2 flex items-center gap-2 text-g-meta text-ink-mid">
          <span className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-brand" />
          <span className="min-w-0 truncate">{last.title}</span>
        </p>
      )}

      {/* 보호자 차례: 이유 한 줄. 방법은 화면 위 배지와 버튼이 말한다. */}
      {waiting && wait && <p className="mt-2 text-g-body font-bold text-warn-ink">{wait.reason}</p>}
      {waiting && wait?.mode === "confirm" && <p className="mt-1 text-g-meta text-ink-mid">{wait.hint}</p>}

      {live && (status === "running" || waiting) && (
        <figure
          // iOS Safari 는 cursor:pointer 가 없는 요소의 클릭을 무시한다. pointerup 으로 받고 pointer 커서를 준다.
          onPointerUp={remote ? tap : undefined}
          role={remote ? "button" : undefined}
          aria-label={remote ? "화면을 눌러 직접 조작" : undefined}
          className={`relative mt-2 overflow-hidden rounded-inner border border-line-soft bg-surface ${remote ? "cursor-pointer select-none [touch-action:manipulation]" : ""}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={live} alt="독도가 지금 보고 있는 화면" className="block w-full" draggable={false} />
          {tapMark && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-warn bg-warn/30"
              style={{ left: `${tapMark.x}%`, top: `${tapMark.y}%` }}
            />
          )}
          <figcaption
            className={`absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-chip px-2 py-0.5 text-g-meta font-bold text-surface ${remote ? "bg-warn-ink" : "bg-danger-ink"}`}
          >
            <span className="size-2 animate-pulse rounded-full bg-surface" />
            {remote ? "눌러서 직접 조작" : "실시간"}
          </figcaption>
        </figure>
      )}

      {waiting && onInput && (
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onInput({ kind: "resume" })}
            className="press on-brand min-h-cta w-full rounded-control bg-brand-deep px-4 text-g-body font-bold text-surface active:bg-brand-press"
          >
            {wait?.mode === "confirm" ? "인증했어요 · 이어서 하기" : "이 단계 끝났어요 · 이어서 하기"}
          </button>
          {/* 글자 입력은 드물다. 접어 두고 필요할 때만 연다. */}
          {remote && !typing && (
            <button type="button" onClick={() => setTyping(true)} className="press min-h-tap self-start rounded-inner px-1 text-g-meta font-bold text-ink-soft active:bg-well">
              글자를 쳐야 하나요?
            </button>
          )}
          {remote && typing && (
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
                placeholder="입력할 글자 (즉시 삭제)"
                autoComplete="off"
                className="min-h-tap min-w-0 flex-1 rounded-control border-[1.5px] border-line bg-surface px-3 text-g-body text-ink"
              />
              <button type="submit" className="press min-h-tap rounded-control bg-well px-3 text-g-body font-bold text-ink active:bg-brand-tint">
                입력
              </button>
            </form>
          )}
        </div>
      )}

      {result && (
        <p className={`mt-2 flex items-start gap-2 text-g-body font-bold ${status === "done" ? "text-ok-ink" : status === "failed" ? "text-danger-ink" : "text-warn-ink"}`}>
          {status === "done" ? <CheckCircle size={20} className="mt-0.5 shrink-0" /> : <WarningCircle size={20} className="mt-0.5 shrink-0" />}
          {result.summary}
        </p>
      )}

      {/* 전체 과정은 펼쳐야 보인다. */}
      {trace.length > 0 && (
        <button
          type="button"
          onClick={() => setShowSteps((v) => !v)}
          aria-expanded={showSteps}
          className="press mt-1 -ml-1 inline-flex min-h-tap items-center gap-1 rounded-inner px-1 text-g-meta font-bold text-ink-soft active:bg-well"
        >
          <CaretRight size={12} className={showSteps ? "rotate-90" : ""} />
          과정 {trace.length}단계 {showSteps ? "접기" : "보기"}
        </button>
      )}
      {showSteps && (
        <ol className="mt-1 space-y-2 border-t border-line-soft pt-2">
          {trace.map((s, i) => (
            <li key={i} className="grid grid-cols-[4.5em_1fr] gap-x-2 text-g-meta">
              <span className="tabular-nums text-ink-soft">{hhmm(s.t)}</span>
              <div className="min-w-0">
                <p className="text-ink">{s.title}</p>
                {s.detail && <p className="break-all text-ink-soft">{s.detail}</p>}
                {s.shot && (
                  <button type="button" onClick={() => setOpenShot(openShot === i ? null : i)} className="mt-0.5 inline-flex items-center gap-1 font-bold text-brand-deep">
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
      )}
    </section>
  );
}
