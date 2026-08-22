"use client";

import { useEffect, useRef, useState } from "react";
import { speak, stopSpeaking } from "@/lib/speak";
import type { DocView } from "@/lib/poll";

// 어르신 화면에는 계좌번호·납부 버튼·결제 링크·신청 버튼이 없다.
// tel: 로 걸리는 번호는 레지스트리의 공식 값 하나뿐이다.
// 문서에서 읽은 번호·링크는 화면에 표시하지도, 누를 수 있게 하지도 않는다.

const RELOAD_MS = 3000;

export default function ElderResult({ doc, onReset }: { doc: DocView; onReset: () => void }) {
  const [cur, setCur] = useState<DocView>(doc);
  const stoppedRef = useRef(false);

  // 자녀가 '처리 완료'를 누르면 이 화면이 스스로 바뀐다 — 닫힌 루프.
  useEffect(() => {
    stoppedRef.current = false;
    const ac = new AbortController();
    const t = setInterval(async () => {
      if (stoppedRef.current) return;
      try {
        const res = await fetch(`/api/documents/${doc.id}`, { signal: ac.signal });
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
  }, [doc.id]);

  useEffect(() => stopSpeaking, []);

  const p = cur.phrases;
  const r = cur.result;
  if (!p || !r) return null;

  const danger = r.verdict === "mismatch";
  const safePhone = r.safeContact?.phones?.[0];
  const lines = p.screenLines;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
      {danger ? (
        <section className="rounded-3xl bg-red-50 p-6 ring-4 ring-red-500">
          <p className="text-3xl font-extrabold text-red-700">⚠ 잠깐만요</p>
          {/* 무엇이 어긋났는지는 판정에서 온다. 화면에서 다시 지어내지 않는다. */}
          <p className="mt-4 text-2xl font-bold leading-relaxed">
            {lines.map((l, i) => (
              <span key={i} className="block">
                {l}
              </span>
            ))}
          </p>
          {safePhone && (
            <a
              href={`tel:${safePhone}`}
              className="mt-6 block rounded-2xl bg-red-600 px-6 py-5 text-center text-2xl font-bold text-white"
            >
              📞 공식 번호로 전화 ({safePhone})
            </a>
          )}
          <p className="mt-3 text-base leading-relaxed text-neutral-600">
            문서에 적힌 번호는 누를 수 없게 했습니다
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <p className="text-2xl font-semibold text-neutral-600">{p.docLabel}</p>
          {lines.map((l, i) => (
            <p
              key={i}
              className={
                i === lines.length - 1 ? "text-5xl font-extrabold" : "text-4xl font-bold"
              }
            >
              {l}
            </p>
          ))}
        </section>
      )}

      {cur.resolution_status === "done" ? (
        <p className="rounded-2xl bg-emerald-50 px-5 py-4 text-xl font-bold text-emerald-800">
          ✓ 자녀분이 처리했어요
        </p>
      ) : cur.resolution_status === "acknowledged" ? (
        <p className="rounded-2xl bg-sky-50 px-5 py-4 text-xl font-bold text-sky-800">
          ✓ 자녀분이 확인했어요
        </p>
      ) : (
        <p className="rounded-2xl bg-neutral-100 px-5 py-4 text-xl font-semibold">
          ✓ 자녀분께 보냈어요
        </p>
      )}

      <button
        onClick={() => speak(p.speech)}
        className="rounded-2xl border-4 border-[#1a4f8b] px-6 py-5 text-2xl font-bold text-[#1a4f8b]"
      >
        🔊 다시 듣기
      </button>
      <button
        onClick={() => {
          stopSpeaking();
          onReset();
        }}
        className="rounded-2xl bg-neutral-200 px-6 py-4 text-xl font-semibold"
      >
        다른 우편물 찍기
      </button>
    </main>
  );
}
