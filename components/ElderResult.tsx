"use client";

import { useEffect, useRef, useState } from "react";
import { speak, stopSpeaking, getVoice, setVoice, type VoiceKey } from "@/lib/speak";
import { elderHeaders, type DocView } from "@/lib/poll";
import AppBar from "@/components/AppBar";
import { Warning, Phone, PaperPlaneTilt, Eye, CheckCircle, Volume, CheckLine, Doc } from "@/components/icons";

// 어르신 화면에는 계좌번호·납부 버튼·결제 링크·신청 버튼이 없다.
// tel: 로 걸리는 번호는 레지스트리의 공식 값 하나뿐이다.
// 문서에서 읽은 번호·링크는 화면에 표시하지도, 누를 수 있게 하지도 않는다.
//
// 시안(16 Easy summary · 20 Send to child)을 따른다: 제목 → 읽어주기 카드 → 요약 카드(항목|값) → 진행 타임라인.
// 시안의 "자녀에게 보내기" 버튼은 없다 — 사진은 찍는 순간 자녀 화면에 올라가므로 그 사실을 타임라인으로 보여준다.
// 값은 전부 문구 계층(p.screenLines)에서만 온다. 여기서 숫자를 만들지 않는다.

const RELOAD_MS = 3000;

// 문구 계층이 준 줄을 표의 행으로 옮긴다. 값은 그대로 — 여기서 숫자를 만들지 않는다.
function rowOf(line: string): { label: string | null; value: string } {
  if (/까지$/.test(line)) return { label: "기한", value: line.replace(/까지$/, "") };
  if (/원$/.test(line)) return { label: "금액", value: line };
  return { label: null, value: line };
}

type StepTone = "done" | "now" | "wait";
const STEP_TONE: Record<StepTone, { circle: string; chip: string; label: string }> = {
  done: { circle: "bg-ok-tint text-ok", chip: "bg-ok-tint text-ok-ink", label: "완료" },
  now: { circle: "bg-brand-tint text-brand-deep", chip: "bg-brand-tint text-brand-deep", label: "지금" },
  wait: { circle: "bg-well text-ink-soft", chip: "bg-well text-ink-soft", label: "다음" },
};

export default function ElderResult({
  doc,
  elderToken,
  preview,
  onReset,
}: {
  doc: DocView;
  elderToken: string;
  /** 방금 찍은 사진. 결과가 "어느 종이" 얘기인지 붙여 둔다. */
  preview?: string | null;
  onReset: () => void;
}) {
  const [cur, setCur] = useState<DocView>(doc);
  // 이 컴포넌트는 클라이언트에서만 마운트된다(판독 완료 후). 초기값을 저장소에서 바로 읽어도 된다.
  const [voice, setVoiceState] = useState<VoiceKey>(() => getVoice());
  const stoppedRef = useRef(false);

  function pickVoice(v: VoiceKey) {
    setVoice(v);
    setVoiceState(v);
    speak(p?.speech ?? "", { elderToken, voice: v });
  }

  // 자녀가 '처리 완료'를 누르면 이 화면이 스스로 바뀐다 — 닫힌 루프.
  useEffect(() => {
    stoppedRef.current = false;
    const ac = new AbortController();
    const t = setInterval(async () => {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(`/api/documents/${doc.id}`, { signal: ac.signal, headers: elderHeaders(elderToken) });
        if (!res.ok) return;
        const next = (await res.json()) as DocView;
        if (next?.id) setCur(next);
        if (next?.resolution_status === "done") stoppedRef.current = true;
      } catch {
        /* 일시적 실패는 다음 주기에 다시 시도한다 */
      }
    }, RELOAD_MS);
    return () => {
      ac.abort();
      clearInterval(t);
    };
  }, [doc.id, elderToken]);

  useEffect(() => stopSpeaking, []);

  function leave() {
    stopSpeaking();
    onReset();
  }

  const p = cur.phrases;
  const r = cur.result;
  if (!p || !r) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10">
        <AppBar size="lg" onBack={leave} />
        <h1 className="mt-8 text-title text-ink">이 사진을 처리하지 못했어요</h1>
        <button
          type="button"
          onClick={onReset}
          className="press on-brand mt-6 min-h-tap-elder rounded-control bg-brand px-8 text-lead text-surface active:bg-brand-deep"
        >
          다시 찍기
        </button>
      </main>
    );
  }

  const danger = r.verdict === "mismatch";
  const safePhone = r.safeContact?.phones?.[0];
  const rows = p.screenLines.map(rowOf);

  // 진행 3단계(시안 20). 상태는 색 + 아이콘 + 글자 3중 신호. 값·금액은 여기에 싣지 않는다.
  const agentActive = cur.action_status === "running" || cur.action_status === "queued" || cur.action_status === "waiting";
  const agentDone = cur.action_status === "done";
  const handled = agentDone || cur.resolution_status === "done";
  const seen = handled || agentActive || cur.resolution_status === "acknowledged";
  const steps: { icon: typeof Doc; title: string; desc: string; tone: StepTone }[] = [
    { icon: Doc, title: "우편물을 읽었어요", desc: "찍은 사진을 읽어 정리했어요", tone: "done" },
    {
      icon: seen ? Eye : PaperPlaneTilt,
      title: seen ? "자녀분이 확인했어요" : "자녀분께 보냈어요",
      desc: seen ? "자녀분이 내용을 봤어요" : "자녀분 화면에 올라갔어요",
      tone: "done",
    },
    {
      icon: CheckCircle,
      title: handled ? (agentDone ? "처리됐어요" : "자녀분이 처리했어요") : agentActive ? "자녀분이 승인해서 처리하고 있어요" : "자녀분이 보고 알려드려요",
      desc: agentDone && cur.action_summary ? cur.action_summary : handled ? "이 우편물은 끝났어요" : agentActive ? "끝나면 이 화면이 바뀌어요" : "기다리시면 여기에 표시돼요",
      tone: handled ? "done" : agentActive ? "now" : "wait",
    },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10">
      {/* 경고면 띠 전체가 빨강이 된다. 색·위치·글자가 같은 말을 한다. */}
      <AppBar size="lg" tone={danger ? "danger" : "band"} title={danger ? "확인이 필요한 우편물" : "문서 내용"} onBack={leave} />

      <div className="enter-once flex flex-col gap-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className={`text-title ${danger ? "text-danger-ink" : "text-ink"}`}>{danger ? "잠깐만요" : p.docLabel}</h2>
            <p className="mt-1 text-note text-ink-soft">{danger ? "공식 정보와 다른 내용이 있어요" : "오늘 촬영 · 읽기 완료"}</p>
          </div>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-[4.5rem] shrink-0 rounded-inner bg-well object-cover" />
          )}
        </div>

        {danger ? (
          <section role="alert" className="rounded-sheet border-2 border-danger bg-danger-tint p-5 text-danger-ink">
            <p className="flex items-start gap-3 text-lead text-ink">
              <Warning size={32} className="mt-1 shrink-0 text-danger" />
              <span>
                {rows.map((row, i) => (
                  <span key={i} className="block">
                    {row.value}
                  </span>
                ))}
              </span>
            </p>
            {safePhone && (
              <a
                href={`tel:${safePhone}`}
                className="press mt-5 flex min-h-tap-elder items-center justify-center gap-3 rounded-control bg-danger px-6 text-lead text-surface active:bg-danger-ink"
              >
                <Phone size={28} />
                공식 번호로 전화 {safePhone}
              </a>
            )}
            <p className="mt-4 text-note text-ink-soft">문서에 적힌 번호는 누를 수 없게 했습니다</p>
          </section>
        ) : (
          <section className="rounded-sheet bg-ai-tint p-5">
            <span className="inline-flex items-center gap-1.5 rounded-chip bg-surface px-3 py-1 text-g-meta font-bold text-ai">문서에 적힌 내용</span>
            <dl className="mt-3">
              {rows.map((row, i) =>
                row.label ? (
                  <div key={i} className="flex items-baseline justify-between gap-3 border-t border-ai/15 py-3 first:border-t-0">
                    <dt className="shrink-0 text-body text-ink-mid">{row.label}</dt>
                    <dd className="text-right text-value text-ink">{row.value}</dd>
                  </div>
                ) : (
                  <div key={i} className="border-t border-ai/15 py-3 first:border-t-0">
                    <dd className="text-lead text-ink">{row.value}</dd>
                  </div>
                ),
              )}
            </dl>
          </section>
        )}

        {/* 읽어주기 카드(시안 16). 카드 전체가 버튼이다 — "재생" 알약은 장식. */}
        <button
          type="button"
          onClick={() => speak(p.speech, { elderToken, voice })}
          className="press flex min-h-tap-elder w-full items-center gap-4 rounded-card bg-brand-tint px-4 py-3 text-left active:bg-brand/20"
        >
          <span className="flex size-14 shrink-0 items-center justify-center rounded-inner bg-brand text-surface">
            <Volume size={30} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lead text-ink">다시 들려드릴까요?</span>
            <span className="block text-note text-ink-soft">누르면 처음부터 다시 읽어요</span>
          </span>
          <span className="shrink-0 rounded-chip bg-surface px-4 py-2 text-body font-bold text-brand-deep">재생</span>
        </button>
        {/* 목소리 고르기. 누르면 그 목소리로 바로 다시 읽는다 — 설정 화면을 따로 두지 않는다. */}
        <div className="flex gap-2" role="group" aria-label="목소리">
          {(["m", "f"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={voice === v}
              onClick={() => pickVoice(v)}
              className={`press min-h-14 flex-1 rounded-control px-4 text-body ${
                voice === v ? "bg-brand-tint font-bold text-brand-deep" : "bg-well text-ink-mid"
              }`}
            >
              {v === "m" ? "남자 목소리" : "여자 목소리"}
            </button>
          ))}
        </div>

        {/* 진행 타임라인(시안 20). */}
        <section className="rounded-card bg-surface p-5 shadow-card" aria-live="polite">
          <ol className="relative flex flex-col gap-5">
            <span aria-hidden="true" className="absolute bottom-6 left-[1.375rem] top-6 w-0.5 bg-line-soft" />
            {steps.map((s, i) => {
              const t = STEP_TONE[s.tone];
              const Icon = s.icon;
              return (
                <li key={i} className="relative flex items-center gap-3">
                  <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${t.circle}`}>
                    {s.tone === "done" ? <CheckLine size={24} /> : <Icon size={24} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-body font-bold ${s.tone === "wait" ? "text-ink-mid" : "text-ink"}`}>{s.title}</span>
                    <span className="block text-note text-ink-soft">{s.desc}</span>
                  </span>
                  <span className={`shrink-0 rounded-chip px-3 py-1 text-g-meta font-bold ${t.chip}`}>{t.label}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <button
          type="button"
          onClick={leave}
          className="press on-brand min-h-tap-elder rounded-control bg-brand px-6 text-lead text-surface active:bg-brand-deep"
        >
          다른 우편물 찍기
        </button>
      </div>
    </main>
  );
}
