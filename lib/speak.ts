// 기기 내장 TTS. 네트워크가 필요 없다.
//
// ⚠ iOS 함정 두 개 — 데모가 여기서 깨진다.
//   1) 무음(벨소리) 스위치가 켜져 있으면 소리가 나지 않는다. 하드웨어라 코드로 못 푼다.
//   2) **첫 발화는 사용자 제스처 안에서 일어나야 한다.** 판독이 끝난 뒤(비동기 콜백)
//      speak() 를 부르면 iOS Safari 가 조용히 무시한다.
//      그래서 '사진 찍기' 버튼을 누르는 순간 빈 발화로 잠금을 푼다(prime).
//
// 예약된 발화(음성 목록 대기)는 세대 번호로 묶는다. stopSpeaking() 이나 다음 speak() 가
// 오면 이전 예약은 절대 발화되지 않는다 — 지난 문서의 금액이 600ms 뒤에 튀어나오면 안 된다.

const RATE = 0.85;
const VOICE_WAIT_MS = 600;

let generation = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingListener: (() => void) | null = null;

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
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

/** 사용자 제스처 안에서 부른다. 이후의 프로그램적 speak() 가 허용된다. */
export function primeSpeech(): void {
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
    /* 잠금 해제 실패는 흐름을 막지 않는다 */
  }
}

export function speak(text: string, rate = RATE): void {
  const s = synth();
  if (!s || !text) return;
  const gen = ++generation;
  clearPending(s);

  const say = () => {
    // 그 사이 다른 speak()/stop 이 왔으면 이 발화는 버린다.
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
  // 음성 목록이 아직 없으면 한 번만 기다렸다가 말한다. 둘 중 먼저 오는 쪽이 말하고 나머지는 지운다.
  pendingListener = say;
  s.addEventListener("voiceschanged", pendingListener, { once: true });
  pendingTimer = setTimeout(say, VOICE_WAIT_MS);
}

export function stopSpeaking(): void {
  generation++;
  const s = synth();
  clearPending(s);
  s?.cancel();
}
