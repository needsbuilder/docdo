"use client";

import { useEffect, useRef, useState } from "react";
import { speak, stopSpeaking, getVoice, setVoice, type VoiceKey } from "@/lib/speak";
import { elderHeaders, type DocView } from "@/lib/poll";
import AppBar from "@/components/AppBar";
import { Warning, Phone, SpeakerHigh, PaperPlaneTilt, Eye, CheckCircle } from "@/components/icons";

// 어르신 화면에는 계좌번호·납부 버튼·결제 링크·신청 버튼이 없다.
// tel: 로 걸리는 번호는 레지스트리의 공식 값 하나뿐이다.
// 문서에서 읽은 번호·링크는 화면에 표시하지도, 누를 수 있게 하지도 않는다.
//
// 결과는 고지서의 표 문법으로 보여준다: 항목 | 값. 어르신이 평생 본 형식이다.

const RELOAD_MS = 3000;

// 문구 계층이 준 줄을 표의 행으로 옮긴다. 값은 그대로 — 여기서 숫자를 만들지 않는다.
function rowOf(line: string): { label: string | null; value: string } {
  if (/까지$/.test(line)) return { label: "기한", value: line.replace(/까지$/, "") };
  if (/원$/.test(line)) return { label: "금액", value: line };
  return { label: null, value: line };
}

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

  const p = cur.phrases;
  const r = cur.result;
  if (!p || !r) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10">
        <AppBar size="lg" />
        <h1 className="mt-8 text-value text-ink">이 사진을 처리하지 못했어요</h1>
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

  // 상태 배지는 색 + 아이콘 + 글자 3중 신호. "보냈어요"에 체크는 의미가 틀리다.
  const status =
    cur.action_status === "done"
      ? { icon: CheckCircle, text: cur.action_summary ? `처리됐어요 — ${cur.action_summary}` : "처리됐어요", cls: "bg-ok-tint text-ok-ink" }
      : cur.action_status === "running" || cur.action_status === "queued" || cur.action_status === "waiting"
        ? { icon: Eye, text: "자녀분이 승인해서 처리하고 있어요", cls: "bg-brand-tint text-brand" }
      : cur.resolution_status === "done"
      ? { icon: CheckCircle, text: "자녀분이 처리했어요", cls: "bg-ok-tint text-ok-ink" }
      : cur.resolution_status === "acknowledged"
        ? { icon: Eye, text: "자녀분이 확인했어요", cls: "bg-brand-tint text-brand" }
        : { icon: PaperPlaneTilt, text: "자녀분께 보냈어요", cls: "bg-well text-ink-mid" };
  const StatusIcon = status.icon;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10">
      {/* 경고면 머리띠 전체가 빨강이 된다. 색·위치·글자가 같은 말을 한다. */}
      <AppBar size="lg" tone={danger ? "danger" : "band"}>
        <div className="flex items-end justify-between gap-4 pb-6 pt-2">
          <div>
            <p className="text-note text-surface/75">{danger ? "확인이 필요한 우편물" : "읽어드린 우편물"}</p>
            <h1 className="mt-1 text-value">{danger ? "잠깐만요" : p.docLabel}</h1>
          </div>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-16 shrink-0 rounded-inner border-2 border-surface/60 object-cover" />
          )}
        </div>
      </AppBar>

      <div className="enter-once flex flex-col gap-5 pt-5">
        {danger ? (
          <section role="alert" className="rounded-card border-4 border-danger bg-danger-tint p-5 text-danger-ink">
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
          <table className="w-full border-t-2 border-ink">
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-line-soft">
                  {row.label ? (
                    <>
                      <th scope="row" className="w-[4.5em] py-4 pr-3 text-left align-top text-body font-bold text-ink-mid">
                        {row.label}
                      </th>
                      <td className="py-4 text-right text-hero text-ink">{row.value}</td>
                    </>
                  ) : (
                    <td colSpan={2} className="py-4 text-lead text-ink">
                      {row.value}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className={`flex items-center gap-3 rounded-control px-5 py-4 text-body ${status.cls}`}>
          <StatusIcon size={24} />
          {status.text}
        </p>

        <button
          type="button"
          onClick={() => speak(p.speech, { elderToken, voice })}
          className="press flex min-h-tap-elder items-center justify-center gap-3 rounded-control border-2 border-brand bg-surface px-6 text-lead text-brand active:bg-brand-tint"
        >
          <SpeakerHigh size={32} />
          다시 듣기
        </button>
        {/* 목소리 고르기. 누르면 그 목소리로 바로 다시 읽는다 — 설정 화면을 따로 두지 않는다. */}
        <div className="flex gap-2" role="group" aria-label="목소리">
          {(["m", "f"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={voice === v}
              onClick={() => pickVoice(v)}
              className={`press min-h-tap-elder flex-1 rounded-control border-2 px-4 text-body ${
                voice === v ? "border-brand bg-brand-tint text-brand" : "border-line bg-surface text-ink-mid"
              }`}
            >
              {v === "m" ? "남자 목소리" : "여자 목소리"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            stopSpeaking();
            onReset();
          }}
          className="press min-h-tap-elder rounded-control bg-well px-6 text-body text-ink-mid active:bg-brand-tint"
        >
          다른 우편물 찍기
        </button>
      </div>
    </main>
  );
}
