// "홈 화면에 추가"가 지금 상태(어르신 토큰·보호자 역할)를 품게 manifest 링크를 바꾼다.
// iOS 는 추가하는 순간의 manifest start_url 을 아이콘에 새긴다. 링크는 head 에 하나만 있어야 한다.

export function pointManifest(query: string): void {
  if (typeof document === "undefined") return;
  const href = `/manifest.json?${query}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}
