"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VERDICT_LABEL } from "@/lib/verify";
import type { Verdict } from "@/lib/types";
import type { DocView } from "@/lib/poll";
import CheckList from "@/components/CheckList";

// 여기에 모든 행동이 모인다. 어르신 화면에는 없는 것들이다.
// 다만 실행 경로가 되는 연락처·링크는 레지스트리 값만 쓴다 — 문서에서 읽은 값은 표시만 한다.

const LIST_MS = 3000;

const TONE: Record<string, string> = {
  mismatch: "border-red-500 bg-red-50",
  review: "border-amber-400 bg-amber-50",
  unknown_issuer: "border-neutral-400 bg-neutral-50",
  needs_human: "border-neutral-400 bg-neutral-50",
  not_checkable: "border-neutral-400 bg-neutral-50",
  failed: "border-neutral-300 bg-neutral-50",
  no_extract: "border-neutral-200 bg-neutral-50",
  clear: "border-neutral-200 bg-white",
};

function money(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString("ko-KR")}원` : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export default function Guardian() {
  const [docs, setDocs] = useState<DocView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const drivingRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/documents", { signal });
      if (!res.ok) return;
      const d = (await res.json()) as { documents?: DocView[] };
      setDocs(d.documents ?? []);
      setLoaded(true);
    } catch {
      /* 다음 주기에 다시 시도한다 */
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    // 탭이 가려져 있으면 조회하지 않는다. 데모 중에 쓸데없이 호출을 태우지 않는다.
    const tick = () => {
      if (document.visibilityState === "visible") void load(ac.signal);
    };
    // 첫 조회도 타이머로 넘긴다 — 이펙트 본문에서 상태를 직접 건드리지 않게.
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, LIST_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      ac.abort();
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  // 목록 API 는 Upstage 를 부르지 않는다. 판정이 없는 문서는 여기서 끌어와야
  // 어르신 화면을 닫아도 자녀 화면이 스스로 완료된다.
  useEffect(() => {
    for (const d of docs) {
      if (d.result || drivingRef.current.has(d.id)) continue;
      if (d.pipeline_status === "error") continue;
      drivingRef.current.add(d.id);
      fetch(`/api/documents/${d.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((next: DocView | null) => {
          if (next?.id) setDocs((ds) => ds.map((x) => (x.id === next.id ? next : x)));
        })
        .catch(() => {})
        .finally(() => drivingRef.current.delete(d.id));
    }
  }, [docs]);

  async function mark(id: string, resolution: "acknowledged" | "done") {
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as DocView;
      setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...updated } : d)));
    } catch {
      /* 실패하면 상태를 바꾸지 않는다. 다음 목록 조회가 진실이다 */
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-bold">부모님 우편물</h1>
      <p className="mb-6 text-sm leading-relaxed text-neutral-500">
        어르신이 찍으면 여기에 바로 올라옵니다
      </p>

      <div className="space-y-4">
        {docs.map((d) => {
          const r = d.result;
          const f = (r?.fields ?? {}) as Record<string, unknown>;
          const amount = money(f.amount_krw);
          const issuer = text(f.issuer);
          const due = text(f.due_date) ?? text(f.apply_deadline);
          const officialPhone = r?.safeContact?.phones?.[0];
          const officialHost = r?.safeContact?.hosts?.[0];

          return (
            <article
              key={d.id}
              className={`rounded-2xl border-2 p-5 ${TONE[d.verdict ?? ""] ?? "border-neutral-200"}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-bold">
                  {d.phrases?.docLabel ?? (r ? "우편물" : "읽는 중…")}
                </h2>
                <span className="shrink-0 text-sm font-semibold">
                  {d.verdict ? VERDICT_LABEL[d.verdict as Verdict] : ""}
                </span>
              </div>

              {r && (
                <p className="mt-2 text-sm leading-relaxed text-neutral-700">
                  {[issuer, amount, due && `${due}까지`].filter(Boolean).join(" · ")}
                </p>
              )}

              {r && (
                <div className="mt-3">
                  <CheckList result={r} />
                </div>
              )}

              {r?.reasons && r.reasons.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm leading-relaxed">
                  {r.reasons.map((x, i) => (
                    <li
                      key={i}
                      className={
                        x.rule === "R3" || x.rule === "R5" ? "text-neutral-600" : "text-red-700"
                      }
                    >
                      · [{x.rule}] {x.detail}
                      <span className="text-neutral-500"> → {x.action}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* 실행 경로는 레지스트리 값만. 문서에서 읽은 번호·링크는 링크가 되지 않는다. */}
              {r && (officialPhone || officialHost) && (
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  {officialPhone && (
                    <a
                      href={`tel:${officialPhone}`}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-2 font-medium"
                    >
                      📞 공식 대표번호 {officialPhone}
                    </a>
                  )}
                  {officialHost && (
                    <a
                      href={`https://${officialHost}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-2 font-medium"
                    >
                      🔗 공식 사이트 열기
                    </a>
                  )}
                </div>
              )}

              {r && (
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => mark(d.id, "acknowledged")}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                      d.resolution_status !== "new"
                        ? "bg-neutral-200"
                        : "bg-neutral-800 text-white"
                    }`}
                  >
                    확인함
                  </button>
                  <button
                    onClick={() => mark(d.id, "done")}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                      d.resolution_status === "done"
                        ? "bg-emerald-600 text-white"
                        : "bg-neutral-800 text-white"
                    }`}
                  >
                    {d.resolution_status === "done" ? "처리 완료됨" : "처리 완료"}
                  </button>
                </div>
              )}
            </article>
          );
        })}

        {loaded && docs.length === 0 && (
          <p className="text-neutral-500">아직 받은 우편물이 없습니다.</p>
        )}
      </div>
    </main>
  );
}
