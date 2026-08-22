// 어르신은 계정이 없다. 보호자가 준 링크(/elder?h=토큰)를 한 번 열면 폰에 저장되고,
// 이후로는 링크 없이도 그 가구로 올라간다.
//
// URL 의 토큰은 읽자마자 주소창에서 지운다 — 미러링 촬영·히스토리·리퍼러에 남기지 않는다.

const KEY = "docdo_h";
const SHAPE = /^[A-Za-z0-9_-]{20,64}$/;

export function readElderToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const u = new URL(window.location.href);
    const fromUrl = u.searchParams.get("h");
    if (fromUrl && SHAPE.test(fromUrl)) {
      localStorage.setItem(KEY, fromUrl);
      u.searchParams.delete("h");
      window.history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
      return fromUrl;
    }
    const stored = localStorage.getItem(KEY);
    return stored && SHAPE.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function clearElderToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 저장소 접근 불가 */
  }
}
