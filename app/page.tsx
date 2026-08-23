import Link from "next/link";
import AppBar from "@/components/AppBar";
import { Camera, CaretRight } from "@/components/icons";

// 역할 선택. 시안(온보딩)의 "헤드라인 + 부제 + 일러스트 카드 + Primary 1개" 구조를 가져왔다.
// 시안의 부제 "무엇을 해야 하는지 알려드려요"는 원칙 3(지시하지 않는다)과 어긋나 사실형으로 바꿨다.
// 시안의 사진은 출처가 확인되지 않아(소스 전체 공개 대회) 그 아래 깔린 종이 일러스트를 CSS 로 재현했다.
// 보호자 진입은 시안의 15px 텍스트 링크 대신 카드 버튼 — 어르신도 보는 화면이라 터치 타깃을 줄이지 않는다.

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10">
      <AppBar size="lg" />

      <h1 className="mt-8 text-balance text-title text-ink">
        복잡한 문서,
        <br />
        이제 사진만 찍으세요
      </h1>
      <p className="mt-3 text-note text-ink-soft">언제까지, 무엇이 적혀 있는지 쉽게 읽어드려요.</p>

      {/* 일러스트 — 기울어진 종이 두 장과 카메라. 시안의 카드(radius 30, #eaf4ff) 그대로. */}
      <div aria-hidden="true" className="relative mt-6 aspect-[354/300] w-full overflow-hidden rounded-[30px] bg-brand-tint">
        <div className="absolute left-[22%] top-[16%] h-[64%] w-[46%] -rotate-[7deg] rounded-[18px] bg-[#d6eaff]" />
        <div className="absolute left-[30%] top-[13%] flex h-[68%] w-[46%] rotate-[5deg] flex-col gap-[7%] rounded-[18px] bg-surface p-[6%] shadow-raise">
          <span className="h-[6%] w-[58%] rounded-full bg-brand" />
          <span className="h-[6%] w-[80%] rounded-full bg-line-soft" />
          <span className="h-[6%] w-[72%] rounded-full bg-line-soft" />
          <span className="h-[6%] w-[64%] rounded-full bg-line-soft" />
          <span className="mt-auto h-[6%] w-[40%] rounded-full bg-line-soft" />
        </div>
        <span className="absolute bottom-[10%] right-[10%] flex size-[18%] items-center justify-center rounded-[18px] bg-surface text-brand shadow-raise">
          <Camera size={36} />
        </span>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <Link
          href="/elder"
          className="press on-brand flex min-h-[5.5rem] items-center gap-4 rounded-control bg-brand px-6 py-4 text-surface active:bg-brand-deep"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-lead leading-tight">어르신이에요</span>
            <span className="mt-1 block text-note text-surface/85">우편물을 찍고 들어요</span>
          </span>
          <CaretRight size={24} className="shrink-0 text-surface/80" />
        </Link>
        <Link
          href="/guardian"
          className="press flex min-h-[5.5rem] items-center gap-4 rounded-control bg-surface px-6 py-4 text-ink shadow-card active:bg-brand-tint"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-lead leading-tight">부모님을 도와드려요</span>
            <span className="mt-1 block text-note text-ink-soft">대조 결과까지 확인해요</span>
          </span>
          <CaretRight size={24} className="shrink-0 text-ink-soft" />
        </Link>
      </div>
    </main>
  );
}
