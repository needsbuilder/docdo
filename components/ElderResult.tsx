"use client";

import { useEffect, useRef, useState } from "react";
import { speak, stopSpeaking } from "@/lib/speak";
import { elderHeaders, type DocView } from "@/lib/poll";
import { Warning, Phone, SpeakerHigh, PaperPlaneTilt, Eye, CheckCircle } from "@/components/icons";

// 어르신 화면에는 계좌번호·납부 버튼·결제 링크·신청 버튼이 없다.
// tel: 로 걸리는 번호는 레지스트리의 공식 값 하나뿐이다.
// 문서에서 읽은 번호·링크는 화면에 표시하지도, 누를 수 있게 하지도 않는다.

const RELOAD_MS = 3000;

export default function ElderResult({
  doc,
  elderToken,
  onReset,
}: {
  doc: DocView;
  elderToken: string;
  onReset: () => void;
}) {
  const [cur, setCur] = useState<DocView>(doc);
  const stoppedRef = useRef(false);

  // 자녀가 '처리 완료'를 누르면 이 화면이 스스로 바뀐다 — 닫힌 루프.
  useEffect(() => {
    stoppedRef.current = false;
    const ac = new AbortController();
    const t = setInterval(async () => {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(`/api/documents/${doc.id}`, {
          signal: ac.signal,
          headers: elderHeaders(elderToken),
        });
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

  const p = cur.phrases;
  const r = cur.result;
  if (!p || !r) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 py-10">
        <p className="text-center text-lead text-ink">이 사진을 처리하지 못했어요</p>
        <button
          type="button"
          onClick={onReset}
          className="press on-brand min-h-tap-elder rounded-control border-2 border-brand bg-brand px-8 text-lead text-surface active:bg-brand-deep"
        >
          다시 찍기
        </button>
      </main>
    );
  }

  const danger = r.verdict === "mismatch";
  const safePhone = r.safeContact?.phones?.[0];
  const lines = p.screenLines;

  // 상태 배지는 색 + 아이콘 + 글자 3중 신호. "보냈어요"에 체크는 의미가 틀리다.
  const status =
    cur.resolution_status === "done"
      ? { icon: CheckCircle, text: "자녀분이 처리했어요", cls: "border-ok bg-ok-tint text-ok-ink" }
      : cur.resolution_status === "acknowledged"
        ? { icon: Eye, text: "자녀분이 확인했어요", cls: "border-brand bg-brand-tint text-brand" }
        : { icon: PaperPlaneTilt, text: "자녀분께 보냈어요", cls: "border-line bg-surface text-ink-mid" };
  const StatusIcon = status.icon;

  return (
    <main className="enter-once mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-6 py-10">
      {danger ? (
        <section
          role="alert"
          className="rounded-card border-4 border-danger bg-danger-tint p-6 text-danger-ink"
        >
          <p className="flex items-center gap-3 text-value">
            <Warning size={40} />
            잠깐만요
          </p>
          {/* 무엇이 어긋났는지는 판정에서 온다. 화면에서 다시 지어내지 않는다. */}
          <p className="mt-4 text-lead text-ink">
            {lines.map((l, i) => (
              <span key={i} className="block">
                {l}
              </span>
            ))}
          </p>
          {safePhone && (
            <a
              href={`tel:${safePhone}`}
              className="press mt-6 flex min-h-tap-elder items-center justify-center gap-3 rounded-control border-2 border-danger bg-danger px-6 text-lead text-surface active:bg-danger-ink"
            >
              <Phone size={28} />
              공식 번호로 전화 {safePhone}
            </a>
          )}
          <p className="mt-4 text-note text-ink-soft">문서에 적힌 번호는 누를 수 없게 했습니다</p>
        </section>
      ) : (
        <section className="rounded-card border-2 border-line bg-surface p-6 shadow-card">
          <p className="text-body text-ink-soft">{p.docLabel}</p>
          {lines.map((l, i) => (
            <p
              key={i}
              className={`mt-2 ${i === lines.length - 1 ? "text-hero text-ink" : "text-value text-ink-mid"}`}
            >
              {l}
            </p>
          ))}
        </section>
      )}

      <p className={`flex items-center gap-3 rounded-control border-2 px-5 py-4 text-body ${status.cls}`}>
        <StatusIcon size={24} />
        {status.text}
      </p>

      <button
        type="button"
        onClick={() => speak(p.speech)}
        className="press flex min-h-tap-elder items-center justify-center gap-3 rounded-control border-4 border-brand bg-surface px-6 text-lead text-brand active:bg-brand-tint"
      >
        <SpeakerHigh size={32} />
        다시 듣기
      </button>
      <button
        type="button"
        onClick={() => {
          stopSpeaking();
          onReset();
        }}
        className="press min-h-tap-elder rounded-control border-2 border-line bg-surface px-6 text-body text-ink-mid active:bg-brand-tint"
      >
        다른 우편물 찍기
      </button>
    </main>
  );
}
