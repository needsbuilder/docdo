"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { compress } from "@/lib/compress";
import { primeSpeech, speak } from "@/lib/speak";
import { pollDocument, PollTimeout, type DocView } from "@/lib/poll";
import ElderResult from "@/components/ElderResult";

type Stage = "idle" | "uploading" | "waiting" | "done" | "error";

// 대기 문구는 시간이 갈수록 바뀐다. 같은 화면이 40초 넘게 멈춰 있으면 고장으로 읽힌다.
const WAIT_TEXT = [
  "사진을 안전하게 보내고 있어요",
  "문서를 읽고 있어요",
  "사진 상태에 따라 조금 더 걸릴 수 있어요",
  "분석은 계속돼요. 잠시만 기다려 주세요",
];

// 심사위원이 실물 우편물 없이도 파이프라인을 돌려볼 수 있어야 한다.
// 전부 팀이 만든 합성 견본이다. 실재하는 개인·계좌 정보가 들어 있지 않다.
const SAMPLES: [file: string, label: string][] = [
  ["01-normal.jpg", "정상 고지서로 체험"],
  ["02-tampered.jpg", "사칭 의심 문서로 체험"],
  ["03-welfare.jpg", "복지 안내문으로 체험"],
];

function waitLine(seconds: number): string {
  if (seconds > 45) return WAIT_TEXT[3];
  if (seconds > 15) return WAIT_TEXT[2];
  return WAIT_TEXT[1];
}

export default function Elder() {
  const [stage, setStage] = useState<Stage>("idle");
  const [seconds, setSeconds] = useState(0);
  const [doc, setDoc] = useState<DocView | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (stage !== "uploading" && stage !== "waiting") return;
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  // 화면을 떠나면 폴링을 멈춘다.
  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = useCallback(async (f: File) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStage("uploading");
    setSeconds(0);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/documents", {
        method: "POST",
        body: fd,
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`업로드 실패 ${res.status}`);
      const { id } = (await res.json()) as { id: string };

      setStage("waiting");
      const result = await pollDocument(id, { signal: ac.signal });
      if (ac.signal.aborted) return;

      setDoc(result);
      setStage("done");
      if (result.phrases?.speech) speak(result.phrases.speech);
    } catch (e) {
      if (ac.signal.aborted) return;
      setStage("error");
      if (e instanceof PollTimeout) {
        speak("판독이 예상보다 오래 걸리고 있어요. 잠시 후 다시 찍어 주세요.");
      }
    }
  }, []);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    // 같은 파일을 다시 골라도 change 가 뜨도록 값을 비운다.
    e.target.value = "";
    if (!f) return;
    const { file } = await compress(f);
    await submit(file);
  }

  async function onSample(file: string) {
    // 체험도 실제 경로를 그대로 탄다. 저장된 결과를 다시 보여주지 않는다.
    primeSpeech();
    try {
      const blob = await fetch(`/samples/${file}`).then((r) => r.blob());
      await submit(new File([blob], file, { type: "image/jpeg" }));
    } catch {
      setStage("error");
    }
  }

  function onShoot() {
    // iOS 는 첫 발화가 사용자 제스처 안에서 일어나야 한다.
    // 여기서 풀어두지 않으면 판독 완료 후의 speak() 가 조용히 무시된다.
    primeSpeech();
    inputRef.current?.click();
  }

  if (stage === "done" && doc) {
    return (
      <ElderResult
        doc={doc}
        onReset={() => {
          setDoc(null);
          setStage("idle");
        }}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 p-6">
      {stage === "idle" && (
        <>
          <p className="text-center text-2xl font-semibold leading-relaxed">
            우편물을
            <br />
            사진으로 찍어주세요
          </p>
          <button
            onClick={onShoot}
            className="flex h-56 w-56 flex-col items-center justify-center gap-3 rounded-full bg-[#1a4f8b] text-white shadow-lg active:scale-95"
          >
            <span className="text-6xl" aria-hidden>
              📷
            </span>
            <span className="text-2xl font-bold">사진 찍기</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPick}
            className="hidden"
          />

          <div className="mt-2 flex w-full flex-col gap-2">
            <p className="text-center text-sm text-neutral-500">사진이 없으신가요?</p>
            {SAMPLES.map(([file, label]) => (
              <button
                key={file}
                onClick={() => onSample(file)}
                className="rounded-xl border border-neutral-300 px-4 py-3 text-base font-medium"
              >
                {label}
              </button>
            ))}
            <p className="text-center text-xs leading-relaxed text-neutral-400">
              전부 합성 견본입니다. 실제 파이프라인이 그대로 돌아갑니다.
            </p>
          </div>
        </>
      )}

      {(stage === "uploading" || stage === "waiting") && (
        <div className="flex flex-col items-center gap-6" aria-live="polite">
          <div className="h-20 w-20 animate-spin rounded-full border-8 border-neutral-200 border-t-[#1a4f8b]" />
          <p className="text-center text-2xl font-semibold leading-relaxed">
            {stage === "uploading" ? WAIT_TEXT[0] : waitLine(seconds)}
          </p>
        </div>
      )}

      {stage === "error" && (
        <div className="flex flex-col items-center gap-6">
          <p className="text-center text-2xl font-semibold leading-relaxed">
            잠시 문제가 있었어요
          </p>
          <button
            onClick={() => setStage("idle")}
            className="rounded-2xl bg-[#1a4f8b] px-8 py-5 text-2xl font-bold text-white"
          >
            다시 찍기
          </button>
        </div>
      )}
    </main>
  );
}
