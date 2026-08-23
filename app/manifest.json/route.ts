import { NextResponse } from "next/server";

// 홈 화면 웹앱(PWA) manifest. 정적 파일이 아니라 라우트인 이유:
//   iOS 는 Safari 와 홈 화면 웹앱의 저장소가 분리돼 있다. Safari 에서 링크(/elder?h=토큰)를 열어 연결해 둬도
//   홈 화면 아이콘으로 열면 토큰이 없어 "링크로 열어 주세요"가 다시 뜬다.
//   그래서 /elder 가 토큰을 넣은 manifest(`?h=토큰`)를 가리키고, "홈 화면에 추가"한 아이콘의 start_url 에 토큰이 실린다.
//   보호자는 `?role=guardian` → /guardian 으로 시작.
// 토큰 모양만 검사한다(lib/elderToken.ts 와 같은 규칙). 유효성은 /elder 가 API 로 확인한다.

const SHAPE = /^[A-Za-z0-9_-]{20,64}$/;

export function GET(req: Request) {
  const u = new URL(req.url);
  const h = u.searchParams.get("h");
  const role = u.searchParams.get("role");
  const elder = !!h && SHAPE.test(h);
  const start = elder ? `/elder?h=${encodeURIComponent(h)}` : role === "guardian" ? "/guardian" : "/";
  const manifest = {
    name: elder ? "독도 — 우편물 읽어드리기" : "독도 DocDo",
    short_name: "독도",
    start_url: start,
    scope: "/",
    display: "standalone",
    background_color: "#f9fafb",
    theme_color: "#f9fafb",
    icons: [
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
    ],
  };
  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
