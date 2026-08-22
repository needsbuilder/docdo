// 기기 내장 TTS. 네트워크가 필요 없다.
//
// ⚠ iOS 함정 두 개 — 데모가 여기서 깨진다.
//   1) 무음(벨소리) 스위치가 켜져 있으면 소리가 나지 않는다. 하드웨어라 코드로 못 푼다.
//   2) **첫 발화는 사용자 제스처 안에서 일어나야 한다.** 판독이 끝난 뒤(비동기 콜백)
//      speak() 를 부르면 iOS Safari 가 조용히 무시한다.
//      그래서 '사진 찍기' 버튼을 누르는 순간 빈 발화로 잠금을 푼다(prime).

const RATE = 0.85;

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

/** 한국어 음성은 비동기로 로드된다. 첫 호출에서 빈 배열이 오는 게 정상이다. */
function koreanVoice(s: SpeechSynthesis): SpeechSynthesisVoice | null {
  return s.getVoices().find((v) => v.lang?.toLowerCase().startsWith("ko")) ?? null;
}

/** 사용자 제스처 안에서 부른다. 이후의 프로그램적 speak() 가 허용된다. */
export function primeSpeech(): void {
  const s = synth();
  if (!s) return;
  try {
    // 목록 로드를 촉발한다.
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
  const say = () => {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = rate;
    const ko = koreanVoice(s);
    if (ko) u.voice = ko;
    s.speak(u);
  };
  if (s.getVoices().length === 0) {
    // 음성 목록이 아직 없으면 한 번만 기다렸다가 말한다.
    const once = () => {
      s.removeEventListener("voiceschanged", once);
      say();
    };
    s.addEventListener("voiceschanged", once);
    // voiceschanged 가 끝내 오지 않는 브라우저도 있다.
    setTimeout(() => {
      s.removeEventListener("voiceschanged", once);
      say();
    }, 600);
    return;
  }
  say();
}

export function stopSpeaking(): void {
  synth()?.cancel();
}
