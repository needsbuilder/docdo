"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { compress } from "@/lib/compress";
import { primeSpeech, speak } from "@/lib/speak";
import { pollDocument, PollTimeout, type DocView } from "@/lib/poll";
import { readElderToken, clearElderToken } from "@/lib/elderToken";
import ElderResult from "@/components/ElderResult";
import { Camera, Envelope } from "@/components/icons";

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
      speak(result.phrases.speech);
    } catch (e) {
      if (stale()) return;
      setStage("error");
      if (e instanceof PollTimeout) {
        setErrorText("판독이 예상보다 오래 걸리고 있어요");
        speak("판독이 예상보다 오래 걸리고 있어요. 잠시 후 다시 찍어 주세요.");
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

  function onShoot() {
    // iOS 는 첫 발화가 사용자 제스처 안에서 일어나야 한다.
    primeSpeech();
    inputRef.current?.click();
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
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        <span className="text-brand">
          <Envelope size={56} />
        </span>
        <h1 className="text-balance text-lead text-ink">자녀분이 보낸 링크로 열어 주세요</h1>
        <p className="text-body text-ink-mid">
          이 화면은 자녀분 계정과 연결돼야 합니다.
          <br />
          자녀분께 &ldquo;독도 링크&rdquo;를 보내 달라고 말씀해 주세요.
        </p>
      </main>
    );
  }

  if (stage === "done" && doc) {
    return <ElderResult doc={doc} elderToken={token} onReset={reset} />;
  }

  const progress = Math.min(0.92, seconds / OBSERVED_MAX_S);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-10 px-6 py-10">
      {stage === "idle" && (
        <>
          <h1 className="text-center text-lead text-ink">
            우편물을
            <br />
            사진으로 찍어주세요
          </h1>
          <button
            type="button"
            onClick={onShoot}
            className="press on-brand flex h-56 w-56 flex-col items-center justify-center gap-3 rounded-full border-4 border-brand bg-brand text-surface shadow-raise active:bg-brand-deep"
          >
            <Camera size={72} />
            <span className="text-lead">사진 찍기</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPick}
            className="hidden"
          />
        </>
      )}

      {(stage === "uploading" || stage === "waiting") && (
        <div className="flex w-full flex-col items-center gap-6" aria-live="polite">
          {preview && (
            // 찍은 사진 그대로. 결과와 무관하게 "이 종이"를 처리 중이라는 신호다.
            <div className="w-full max-w-[22em] overflow-hidden rounded-card border-2 border-line bg-surface shadow-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="방금 찍은 우편물" className="block max-h-[46dvh] w-full object-contain" />
            </div>
          )}
          <div className="w-full max-w-[22em]">
            <div className="h-3 w-full overflow-hidden rounded-chip border border-line bg-surface">
              <div
                className="h-full bg-brand transition-[width] duration-1000 ease-linear"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
          <p className="text-center text-lead text-ink">
            {stage === "uploading" ? WAIT_TEXT[0] : waitLine(seconds)}
          </p>
        </div>
      )}

      {stage === "error" && (
        <div className="flex flex-col items-center gap-6" aria-live="assertive">
          <p className="text-center text-lead text-ink">{errorText}</p>
          <button
            type="button"
            onClick={reset}
            className="press on-brand min-h-tap-elder rounded-control border-2 border-brand bg-brand px-8 text-lead text-surface active:bg-brand-deep"
          >
            다시 찍기
          </button>
        </div>
      )}
    </main>
  );
}
