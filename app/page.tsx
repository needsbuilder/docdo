import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-3xl font-bold">누구신가요?</h1>
      <Link
        href="/elder"
        className="rounded-2xl bg-[#1a4f8b] px-6 py-10 text-center text-3xl font-bold text-white"
      >
        어르신이에요
      </Link>
      <Link
        href="/guardian"
        className="rounded-2xl border-2 border-neutral-300 px-6 py-8 text-center text-xl font-semibold"
      >
        부모님을 도와드려요
      </Link>
    </main>
  );
}
