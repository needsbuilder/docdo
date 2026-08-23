import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocDo — 우편물을 읽어드립니다",
  description: "사진 한 장으로 우편물을 확인하고 자녀에게 전달합니다",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "DocDo" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 확대를 막지 않는다. 저시력 어르신에게서 핀치 줌을 뺏으면 안 된다.
  // 상단바 색은 페이지 배경과 같아야 실기기에서 이음매가 안 보인다. 시안은 흰 앱바라 바탕색.
  themeColor: "#f9fafb",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* 콜드 로드에서 폴백 서체로 첫 화면이 뜨는 시간을 줄인다. */}
        <link rel="preload" href="/fonts/koddi-700.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/koddi-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="min-h-dvh bg-paper text-ink">{children}</body>
    </html>
  );
}
