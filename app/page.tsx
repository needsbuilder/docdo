import Link from "next/link";
import AppBar from "@/components/AppBar";

// 역할 선택. 시연에서 한 기기로 두 화면을 오가기 때문에 입구에서 갈라준다.
// 어르신도 보는 화면이라 두 버튼 다 어르신 기준 크기다.
// 실제 어르신 화면은 자녀가 보낸 링크로 열린다 — /elder 에 링크 없이 들어가면 그 안내가 뜬다.

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10">
      <AppBar size="lg" home={false} />

      <h1 className="mt-10 text-value text-ink">누구신가요?</h1>

      <div className="mt-6 flex flex-col gap-4">
        <Link
          href="/elder"
          className="press on-brand flex min-h-[7rem] items-center gap-5 rounded-card bg-brand px-6 py-5 text-surface shadow-raise active:bg-brand-deep"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-value leading-tight">어르신이에요</span>
            <span className="mt-1 block text-note text-surface/80">우편물을 찍고 들어요</span>
          </span>
        </Link>
        <Link
          href="/guardian"
          className="press flex min-h-[7rem] items-center gap-5 rounded-card border-2 border-line bg-surface px-6 py-5 text-ink active:bg-brand-tint"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-lead leading-tight">부모님을 도와드려요</span>
            <span className="mt-1 block text-note text-ink-soft">읽은 내용과 대조 결과를 확인해요</span>
          </span>
        </Link>
      </div>
    </main>
  );
}
