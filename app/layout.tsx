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
  maximumScale: 1,
  themeColor: "#1a4f8b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-dvh bg-white text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
