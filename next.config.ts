import type { NextConfig } from "next";

// 사진·카메라·API 가 붙는 화면이다. 기본 헤더만으로는 clickjacking 과 정보 유출을 막지 못한다.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 카메라는 우리 출처에서만. 위치·마이크는 쓰지 않는다.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js 는 인라인 부트스트랩 스크립트를 쓴다. 개발 모드의 React 는 eval 도 필요하다.
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      // 어르신 음성: /api/speech 의 mp3 를 blob: 으로 재생하고, iOS 잠금 해제용 무음 WAV 는 data: 다.
      "media-src 'self' blob: data:",
      // 문서에서 읽은 주소로 나가지 않는다. 우리 API Route 만 부른다.
      "connect-src 'self'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
