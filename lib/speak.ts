// 어르신에게 읽어주는 음성.
//   1순위: ElevenLabs (/api/speech → mp3). 사람 목소리에 가깝다.
//   폴백:  기기 내장 TTS. 네트워크·키·크레딧 문제가 있어도 말은 나와야 한다.
//
// ⚠ iOS 함정 두 개 — 데모가 여기서 깨진다.
//   1) 무음(벨소리) 스위치가 켜져 있으면 소리가 나지 않는다. 하드웨어라 코드로 못 푼다.
//   2) **첫 재생은 사용자 제스처 안에서 일어나야 한다.** 판독이 끝난 뒤(비동기 콜백)
//      play() 를 부르면 iOS Safari 가 조용히 무시한다.
//      그래서 '사진 찍기' 버튼을 누르는 순간 <audio> 와 speechSynthesis 둘 다 잠금을 푼다(prime).
//
// 세대 번호로 발화를 묶는다. stopSpeaking() 이나 다음 speak() 가 오면 이전 것은 절대 나오지 않는다 —
// 지난 문서의 금액이 2초 뒤에 튀어나오면 안 된다.

export type VoiceKey = "m" | "f";
const VOICE_STORAGE = "docdo.voice";
const RATE = 0.85;
const VOICE_WAIT_MS = 600;

let generation = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingListener: (() => void) | null = null;
let audio: HTMLAudioElement | null = null;
let audioUrl: string | null = null;

export function getVoice(): VoiceKey {
  try {
    return localStorage.getItem(VOICE_STORAGE) === "f" ? "f" : "m";
  } catch {
    return "m";
  }
}
export function setVoice(v: VoiceKey): void {
  try {
    localStorage.setItem(VOICE_STORAGE, v);
  } catch {
    /* 저장 못 해도 이번 세션은 인자로 넘어간다 */
  }
}

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}
function player(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

/** 한국어 음성은 비동기로 로드된다. 첫 호출에서 빈 배열이 오는 게 정상이다. */
function koreanVoice(s: SpeechSynthesis): SpeechSynthesisVoice | null {
  return s.getVoices().find((v) => v.lang?.toLowerCase().startsWith("ko")) ?? null;
}

function clearPending(s: SpeechSynthesis | null) {
  if (pendingTimer) clearTimeout(pendingTimer);
  if (pendingListener && s) s.removeEventListener("voiceschanged", pendingListener);
  pendingTimer = null;
  pendingListener = null;
}

function releaseAudio() {
  const a = player();
  if (a) {
    a.pause();
    a.removeAttribute("src");
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
}

/** 사용자 제스처 안에서 부른다. 이후의 프로그램적 재생이 허용된다. */
export function primeSpeech(): void {
  const a = player();
  if (a) {
    try {
      // 무음 1프레임 WAV. play() 가 제스처 안에서 한 번 성공하면 이 엘리먼트는 이후 자유롭다.
      a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
      void a.play().catch(() => {});
    } catch {
      /* 잠금 해제 실패는 흐름을 막지 않는다 */
    }
  }
  const s = synth();
  if (!s) return;
  try {
    s.getVoices();
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    u.lang = "ko-KR";
    s.speak(u);
    s.cancel();
  } catch {
    /* 동일 */
  }
}

function speakDevice(text: string, gen: number, rate = RATE): void {
  const s = synth();
  if (!s) return;
  clearPending(s);
  const say = () => {
    if (gen !== generation) return;
    clearPending(s);
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = rate;
    const ko = koreanVoice(s);
    if (ko) u.voice = ko;
    s.speak(u);
  };
  if (s.getVoices().length > 0) {
    say();
    return;
  }
  pendingListener = say;
  s.addEventListener("voiceschanged", pendingListener, { once: true });
  pendingTimer = setTimeout(say, VOICE_WAIT_MS);
}

export type SpeakOptions = { elderToken?: string | null; voice?: VoiceKey };
export type SpeechEngine = "eleven" | "device";

// 어떤 엔진이 읽었는지 화면에 알린다. 폰에는 콘솔이 없다 — 폴백(기기 TTS)이 났는지 눈으로 알 수 있어야 한다.
function announce(engine: SpeechEngine, reason?: string) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("docdo:speech", { detail: { engine, reason } }));
  } catch {
    /* 이벤트 실패는 음성과 무관 */
  }
}

/** ElevenLabs 를 먼저 시도하고, 어떤 이유로든 안 되면 기기 TTS 로 같은 문장을 읽는다. */
export function speak(text: string, opts: SpeakOptions = {}): void {
  if (!text) return;
  const gen = ++generation;
  clearPending(synth());
  synth()?.cancel();
  releaseAudio();

  const a = player();
  if (!a || !opts.elderToken) {
    announce("device", "no-token");
    speakDevice(text, gen);
    return;
  }

  (async () => {
    try {
      const res = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-docdo-h": opts.elderToken as string },
        body: JSON.stringify({ text, voice: opts.voice ?? getVoice() }),
      });
      if (gen !== generation) return;
      if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
      const blob = await res.blob();
      if (gen !== generation) return;
      audioUrl = URL.createObjectURL(blob);
      a.src = audioUrl;
      await a.play();
      announce("eleven");
    } catch (e) {
      if (gen !== generation) return;
      announce("device", e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 80) : String(e));
      speakDevice(text, gen);
    }
  })();
}

export function stopSpeaking(): void {
  generation++;
  const s = synth();
  clearPending(s);
  s?.cancel();
  releaseAudio();
}
