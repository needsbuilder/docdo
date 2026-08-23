import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { ChevronLeft } from "@/components/icons";

// 시안(Figma "최종")의 Top app bar: 흰 바탕 · 높이 64 · 왼쪽 48×48 뒤로가기 · 가운데 제목 · 오른쪽 액션.
// 제목이 없으면 브랜드(로고 마크 + 워드마크)를 왼쪽에 둔다 — 온보딩·촬영 화면.
// 경고(mismatch)만 예외로 띠 전체가 빨강이다. 색·위치·글자가 같은 말을 해야 한다.

export function Wordmark({ size = "md", tone = "dark" }: { size?: "md" | "lg"; tone?: "light" | "dark" }) {
  const mark = size === "lg" ? 34 : 28;
  const word = size === "lg" ? 22 : 18;
  return (
    <span className="inline-flex items-center gap-2.5">
      {/* 시안의 로고 마크(주황 문서). 워드마크 "docdo" 는 흰 띠 위에서만 쓴다 — 빨간 띠엔 글자로. */}
      <Image src="/brand/logo-mark.png" alt="" width={mark} height={Math.round((mark * 2182) / 1874)} priority className="shrink-0" />
      {tone === "dark" ? (
        <Image src="/brand/wordmark.png" alt="독도 DocDo" width={Math.round((word * 3902) / 950)} height={word} priority />
      ) : (
        <span className="text-g-title leading-none text-surface">독도 DocDo</span>
      )}
    </span>
  );
}

export default function AppBar({
  title,
  back,
  onBack,
  right,
  size = "md",
  tone = "band",
  children,
}: {
  /** 가운데 제목. 없으면 브랜드를 왼쪽에 둔다. */
  title?: string;
  /** 뒤로가기 링크. onBack 이 있으면 버튼으로. */
  back?: string;
  onBack?: () => void;
  right?: ReactNode;
  size?: "md" | "lg";
  /** band: 흰 앱바. danger: 경고 화면 — 띠 전체가 빨강. */
  tone?: "band" | "danger";
  /** 띠 아래에 붙는 내용(경고 제목 등). 띠와 같은 색 위에 놓인다. */
  children?: ReactNode;
}) {
  const danger = tone === "danger";
  const h = size === "lg" ? "min-h-tap-elder" : "min-h-16";
  const iconBtn = `on-brand inline-flex size-12 shrink-0 items-center justify-center rounded-inner ${danger ? "text-surface active:bg-surface/20" : "text-ink active:bg-well"}`;
  const backEl = onBack ? (
    <button type="button" onClick={onBack} aria-label="뒤로" className={iconBtn}>
      <ChevronLeft size={28} />
    </button>
  ) : back ? (
    <Link href={back} aria-label="뒤로" className={iconBtn}>
      <ChevronLeft size={28} />
    </Link>
  ) : null;

  return (
    <header className={`-mx-6 px-3 ${danger ? "bg-danger text-surface" : "bg-band text-ink"}`}>
      <div className={`flex ${h} items-center gap-1`}>
        {title ? (
          <>
            {backEl ?? <span className="size-12 shrink-0" />}
            <h1 className={`min-w-0 flex-1 truncate text-center ${size === "lg" ? "text-lead" : "text-g-title"}`}>{title}</h1>
            <div className="flex min-w-12 shrink-0 items-center justify-end">{right}</div>
          </>
        ) : (
          <>
            {backEl}
            <div className={`flex min-w-0 flex-1 items-center ${backEl ? "" : "px-3"}`}>
              <Wordmark size={size} tone={danger ? "light" : "dark"} />
            </div>
            {right}
          </>
        )}
      </div>
      {children && <div className="px-3">{children}</div>}
    </header>
  );
}
