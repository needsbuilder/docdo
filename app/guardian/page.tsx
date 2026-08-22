import Link from "next/link";

// Task 7에서 실제 자녀 화면으로 교체된다.
export default function GuardianPlaceholder() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6 text-center">
      <h1 className="text-2xl font-bold">준비 중입니다</h1>
      <p className="text-lg leading-relaxed text-neutral-700">
        부모님께 도착한 우편물을 보는 화면을 만들고 있습니다.
      </p>
      <Link href="/" className="text-lg font-semibold text-[#1a4f8b] underline">
        처음으로
      </Link>
    </main>
  );
}
