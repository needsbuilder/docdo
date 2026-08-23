"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { compress } from "@/lib/compress";
import { primeSpeech, speak } from "@/lib/speak";
import { pollDocument, PollTimeout, type DocView } from "@/lib/poll";
import { readElderToken, clearElderToken } from "@/lib/elderToken";
import ElderResult from "@/components/ElderResult";
import AppBar from "@/components/AppBar";
import { Envelope, CameraLine, ImageLine, AlertTriangle } from "@/components/icons";

type Stage = "idle" | "uploading" | "waiting" | "done" | "error";

// 대기 문구는 시간이 갈수록 바뀐다. 같은 화면이 40초 넘게 멈춰 있으면 고장으로 읽힌다.
const WAIT_TEXT = [
  "사진을 안전하게 보내고 있어요",
  "문서를 읽고 있어요",
  "사진 상태에 따라 조금 더 걸릴 수 있어요",
  "분석은 계속돼요. 잠시만 기다려 주세요",
];

// 관측된 처리시간 4.1~26.2초(n=12). P95 가 아니다 — 진행 바는 이 범위를 따라가되 끝까지 차지 않는다.
const OBSERVED_MAX_S = 26;

// 시안(흐린 사진 · 다시 찍기)의 번호 팁 3개. 촬영 성공률에 닿는 사실 안내이지 금전·폐기 지시가 아니다.
const RETAKE_TIPS = ["밝은 곳에서 찍어 주세요", "종이의 네 모서리가 다 보이게요", "찍기 전에 1초만 멈춰 주세요"];

function waitLine(seconds: number): string {
  if (seconds > 45) return WAIT_TEXT[3];
  if (seconds > 15) return WAIT_TEXT[2];
  return WAIT_TEXT[1];
}

export default function Elder() {
  const [stage, setStage] = useState<Stage>("idle");
  const [seconds, setSeconds] = useState(0);
  const [doc, setDoc] = useState<DocView | null>(null);
  const [errorText, setErrorText] = useState("잠시 문제가 있었어요");
  const [preview, setPreview] = useState<string | null>(null);
  // 보호자가 준 링크의 토큰. null 이면 아직 링크로 연 적이 없다. undefined 는 확인 전.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  // 사진첩에서 고르기 — capture 속성이 없는 두 번째 입력. 자녀가 보내 준 사진도 올릴 수 있다.
  const pickerRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 사진을 고를 때마다 올라간다. 늦게 끝난 압축이 최신 선택을 덮어쓰지 못하게.
  const pickRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (stage !== "uploading" && stage !== "waiting") return;
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  // 링크의 토큰을 읽고 주소창에서 지운다. 한 번 열면 폰에 남는다.
  useEffect(() => {
    const t = setTimeout(() => setToken(readElderToken()), 0);
    return () => clearTimeout(t);
  }, []);

  // 화면을 떠나면 진행 중인 것을 전부 멈춘다. 압축 중이어도 마찬가지다.
  useEffect(() => {
    const picks = pickRef;
    const aborts = abortRef;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      picks.current++;
      aborts.current?.abort();
    };
  }, []);

  // 방금 찍은 사진의 object URL 은 화면을 떠날 때 반드시 놓는다.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const submit = useCallback(async (f: File, pick: number, h: string) => {
    if (pick !== pickRef.current || !mountedRef.current) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const stale = () => pick !== pickRef.current || ac.signal.aborted || !mountedRef.current;

    setStage("uploading");
    setSeconds(0);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("h", h);
      const res = await fetch("/api/documents", { method: "POST", body: fd, signal: ac.signal });
      if (stale()) return;
      if (res.status === 401) {
        // 링크가 더 이상 유효하지 않다. 저장된 토큰을 지워 다음엔 안내 화면이 뜨게 한다.
        clearElderToken();
        setToken(null);
        setStage("idle");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `업로드 실패 ${res.status}`);
      }
      const { id } = (await res.json()) as { id: string };

      setStage("waiting");
      const result = await pollDocument(id, { signal: ac.signal, elderToken: h });
      if (stale()) return;

      if (!result.phrases || !result.result) {
        setErrorText(result.error ?? "이 사진을 처리하지 못했어요");
        setStage("error");
        return;
      }
      setDoc(result);
      setStage("done");
      speak(result.phrases.speech, { elderToken: h });
    } catch (e) {
      if (stale()) return;
      setStage("error");
      if (e instanceof PollTimeout) {
        setErrorText("판독이 예상보다 오래 걸리고 있어요");
        speak("판독이 예상보다 오래 걸리고 있어요. 잠시 후 다시 찍어 주세요.", { elderToken: h });
      } else {
        setErrorText(e instanceof Error && e.message ? e.message : "잠시 문제가 있었어요");
      }
    }
  }, []);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const pick = ++pickRef.current;
    // 어르신에게 "내 사진이 처리 중"이라는 구체적 근거를 보여준다. 범용 스피너가 아니다.
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    setStage("uploading");
    setSeconds(0);
    const { file } = await compress(f);
    if (!token) return;
    await submit(file, pick, token);
  }

  function onShoot(ref: React.RefObject<HTMLInputElement | null>) {
    // iOS 는 첫 발화가 사용자 제스처 안에서 일어나야 한다.
    primeSpeech();
    ref.current?.click();
  }

  function reset() {
    pickRef.current++;
    abortRef.current?.abort();
    setDoc(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setStage("idle");
  }

  if (token === undefined) {
    return <main className="min-h-dvh bg-paper" aria-busy="true" />;
  }

  // 링크 없이 열었다. 계정이 없으니 할 수 있는 게 없다 — 보호자에게 받아야 한다.
  if (token === null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10">
        <AppBar size="lg" back="/" />
        <span className="mt-8 inline-flex size-[4.5rem] items-center justify-center rounded-inner bg-brand-tint text-brand-deep">
          <Envelope size={40} />
        </span>
        <h1 className="mt-5 text-balance text-title text-ink">자녀분이 보낸 링크로 열어 주세요</h1>
        <p className="mt-4 text-body text-ink-mid">
          이 화면은 자녀분 계정과 연결돼야 합니다. 자녀분께 &ldquo;독도 링크&rdquo;를 보내 달라고 말씀해 주세요.
        </p>
      </main>
    );
  }

  if (stage === "done" && doc) {
    return <ElderResult doc={doc} elderToken={token} preview={preview} onReset={reset} />;
  }

  const progress = Math.min(0.92, seconds / OBSERVED_MAX_S);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10">
      <AppBar size="lg" />

      {stage === "idle" && (
        <>
          <h1 className="mt-8 text-balance text-title text-ink">우편물을 사진으로 찍어 주세요</h1>
          <p className="mt-3 text-body text-ink-mid">종이 전체가 한 장에 다 들어오게요.</p>

          {/* 시안(문서 추가 시트)의 카드 2장: 아이콘 박스 + 제목 + 설명 + 쉐브론. 글자는 어르신 크기로. */}
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => onShoot(inputRef)}
              className="press flex min-h-[6rem] w-full items-center gap-4 rounded-card bg-surface px-4 py-4 text-left shadow-card active:bg-brand-tint"
            >
              <span className="flex size-16 shrink-0 items-center justify-center rounded-inner bg-brand text-surface">
                <CameraLine size={40} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="text-body font-bold text-ink">우편물 찍기</span>
                  <span className="rounded-chip bg-brand-tint px-2.5 py-0.5 text-g-meta font-bold text-brand-deep">추천</span>
                </span>
                <span className="block text-note text-ink-soft">고지서·안내문을 바로 찍어요</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onShoot(pickerRef)}
              className="press flex min-h-[6rem] w-full items-center gap-4 rounded-card bg-surface px-4 py-4 text-left shadow-card active:bg-brand-tint"
            >
              <span className="flex size-16 shrink-0 items-center justify-center rounded-inner bg-well text-ink-mid">
                <ImageLine size={34} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-bold text-ink">사진첩에서 고르기</span>
                <span className="block text-note text-ink-soft">받아 둔 우편물 사진을 골라요</span>
              </span>
            </button>
          </div>
          <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />
          <input ref={pickerRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
          <p className="mt-5 text-note text-ink-soft">찍은 사진은 자녀분 화면에도 함께 올라갑니다.</p>
        </>
      )}

      {(stage === "uploading" || stage === "waiting") && (
        <div className="mt-8 flex w-full flex-col gap-5" aria-live="polite">
          <h1 className="text-title text-ink">{stage === "uploading" ? WAIT_TEXT[0] : waitLine(seconds)}</h1>
          {preview && (
            // 찍은 사진 그대로. 결과와 무관하게 "이 종이"를 처리 중이라는 신호다.
            <div className="w-full overflow-hidden rounded-sheet bg-well">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="방금 찍은 우편물" className="block max-h-[52dvh] w-full object-contain" />
            </div>
          )}
          <div className="h-2.5 w-full overflow-hidden rounded-chip bg-line-soft">
            <div className="h-full rounded-chip bg-brand transition-[width] duration-1000 ease-linear" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="text-note text-ink-soft">보통 30초 안에 끝나요. 화면을 닫지 말고 기다려 주세요.</p>
        </div>
      )}

      {stage === "error" && (
        <div className="mt-6 flex flex-col gap-5" aria-live="assertive">
          {/* 시안의 일러스트: 흐린 종이 + 경고 삼각형. 글을 읽기 힘든 어르신에게 "사진이 안 읽혔다"를 그림으로. */}
          <div aria-hidden="true" className="relative h-52 w-full overflow-hidden rounded-[28px] bg-well">
            <div className="absolute left-[22%] top-[14%] flex h-[90%] w-[56%] rotate-[4deg] flex-col gap-[8%] rounded-[14px] bg-[#f3ede2]/70 p-[6%]">
              <span className="h-[6%] w-[70%] rounded-full bg-[#c9bba7]/45" />
              <span className="h-[6%] w-[85%] rounded-full bg-[#c9bba7]/45" />
              <span className="h-[6%] w-[65%] rounded-full bg-[#c9bba7]/45" />
              <span className="h-[6%] w-[80%] rounded-full bg-[#c9bba7]/45" />
              <span className="h-[6%] w-[60%] rounded-full bg-[#c9bba7]/45" />
            </div>
            <span className="absolute bottom-[12%] right-[10%] -rotate-[11deg] text-danger">
              <AlertTriangle size={56} />
            </span>
          </div>
          <div>
            <h1 className="text-title text-ink">{errorText}</h1>
            <p className="mt-2 text-body text-ink-mid">아래처럼 다시 찍어 주세요.</p>
          </div>
          <ol className="flex flex-col gap-2.5">
            {RETAKE_TIPS.map((tip, i) => (
              <li key={tip} className="flex min-h-14 items-center gap-3 rounded-card bg-surface px-3 py-2 shadow-card">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-tint text-body font-bold text-brand-deep">{i + 1}</span>
                <span className="text-note text-ink-mid">{tip}</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={reset}
            className="press on-brand min-h-tap-elder rounded-control bg-brand px-8 text-lead text-surface active:bg-brand-deep"
          >
            다시 찍기
          </button>
        </div>
      )}
    </main>
  );
}
