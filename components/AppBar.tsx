import Link from "next/link";
import type { ReactNode } from "react";

// 고지서 머리띠. 관공서 문서는 상단 남색 띠로 시작한다 — 이 앱의 모든 화면도 그렇게 시작한다.
// 띠는 화면 폭 전체를 쓰고(밖으로 bleed), 내용은 본문 폭에 맞춘다.

export function Wordmark({ size = "md", tone = "light" }: { size?: "md" | "lg"; tone?: "light" | "dark" }) {
  const box = size === "lg" ? 36 : 28;
  const cls = size === "lg" ? "text-lead" : "text-g-title";
  const ink = tone === "light" ? "text-surface" : "text-ink";
  const sub = tone === "light" ? "text-surface/70" : "text-ink-soft";
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" width={box} height={box} aria-hidden="true" className="shrink-0">
        <rect width="32" height="32" rx="7" fill={tone === "light" ? "#fff" : "var(--color-brand)"} />
        <path
          d="M7 10.5h18v12H7z M7 11l9 6.5L25 11"
          fill="none"
          stroke={tone === "light" ? "var(--color-band)" : "#fff"}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <span className={`${cls} leading-none ${ink}`}>독도</span>
      <span className={`text-g-meta leading-none ${sub}`}>DocDo</span>
    </span>
  );
}

export default function AppBar({
  right,
  size = "md",
  home = true,
  tone = "band",
  children,
}: {
  right?: ReactNode;
  size?: "md" | "lg";
  home?: boolean;
  /** band: 남색 머리띠. danger: 경고 화면 — 띠 전체가 빨강. */
  tone?: "band" | "danger";
  /** 띠 아래에 붙는 내용(제목·요약). 띠와 같은 색 위에 놓인다. */
  children?: ReactNode;
}) {
  const h = size === "lg" ? "min-h-tap-elder" : "min-h-[3.25rem]";
  const bg = tone === "danger" ? "bg-danger" : "bg-band";
  const mark = (
    <Wordmark size={size} tone="light" />
  );
  return (
    <header className={`-mx-5 ${bg} px-5 text-surface`}>
      <div className={`flex ${h} items-center justify-between gap-3`}>
        {home ? (
          <Link href="/" className={`on-brand -ml-1 inline-flex ${h} items-center rounded-inner px-1`}>
            {mark}
          </Link>
        ) : (
          mark
        )}
        {right}
      </div>
      {children}
    </header>
  );
}
