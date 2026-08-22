import Link from "next/link";
import { Envelope } from "@/components/icons";

// 역할 선택은 어르신도 본다. 두 버튼 다 어르신 기준 크기다.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-10">
      <header className="flex items-center justify-center gap-3 text-brand">
        <Envelope size={36} />
        <span className="text-lead tracking-[-0.01em]">독도</span>
        <span className="text-note text-ink-soft">DocDo</span>
      </header>

      <h1 className="text-center text-lead text-ink">누구신가요?</h1>

      <div className="flex flex-col gap-4">
        <Link
          href="/elder"
          className="press on-brand flex min-h-tap-elder items-center justify-center rounded-card border-2 border-brand bg-brand px-6 py-8 text-center text-value text-surface shadow-raise active:bg-brand-deep"
        >
          어르신이에요
        </Link>
        <Link
          href="/guardian"
          className="press flex min-h-tap-elder items-center justify-center rounded-card border-2 border-line bg-surface px-6 py-6 text-center text-lead text-ink shadow-card active:bg-brand-tint"
        >
          부모님을 도와드려요
        </Link>
      </div>
    </main>
  );
}
