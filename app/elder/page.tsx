import Link from "next/link";

// Task 6에서 실제 촬영·판독 화면으로 교체된다.
export default function ElderPlaceholder() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-bold">준비 중입니다</h1>
      <p className="text-xl leading-relaxed text-neutral-700">
        우편물을 찍어 확인하는 화면을 만들고 있습니다.
      </p>
      <Link href="/" className="text-xl font-semibold text-[#1a4f8b] underline">
        처음으로
      </Link>
    </main>
  );
}
