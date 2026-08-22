import Link from "next/link";
import AppBar from "@/components/AppBar";
import { CaretRight } from "@/components/icons";

// 자녀(보호자)의 입구. 어르신은 자녀가 보낸 링크(/elder?h=…)로만 들어온다 — 역할 선택 화면이 아니다.
// 고지서의 표 문법으로 설명한다: 순서가 있는 과정이라 번호가 정보다.

const STEPS = [
  ["부모님이 찍습니다", "보내드린 링크 하나면 됩니다. 가입도, 설치도 없습니다."],
  ["독도가 읽어드립니다", "무슨 문서인지, 금액과 기한은 얼마인지 큰 글씨와 음성으로."],
  ["여기로 옵니다", "공식 연락처와 대조한 결과, 확인이 필요한 항목까지 함께."],
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10">
      <AppBar home={false}>
        <div className="pb-9 pt-6">
          <p className="text-g-meta font-bold uppercase tracking-[0.08em] text-surface/70">부모님 우편물 확인</p>
          <h1 className="mt-2 text-balance text-[2rem] font-bold leading-[1.25] tracking-[-0.01em]">
            고지서를 대신 읽고,
            <br />
            공식 정보와 대조합니다
          </h1>
        </div>
      </AppBar>

      <ol className="mt-8 border-t-2 border-ink">
        {STEPS.map(([title, body], i) => (
          <li key={i} className="grid grid-cols-[2.5rem_1fr] gap-x-3 border-b border-line-soft py-4">
            <span className="text-g-title tabular-nums text-brand">{i + 1}</span>
            <div>
              <p className="text-g-title text-ink">{title}</p>
              <p className="mt-1 text-g-body text-ink-mid">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <Link
        href="/guardian"
        className="press on-brand mt-8 flex min-h-[3.5rem] items-center justify-between gap-4 rounded-control bg-brand px-5 text-g-title text-surface active:bg-brand-deep"
      >
        시작하기
        <CaretRight size={24} />
      </Link>
    </main>
  );
}
