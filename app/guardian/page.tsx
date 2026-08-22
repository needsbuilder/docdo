"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VERDICT_LABEL } from "@/lib/verify";
import type { Verdict } from "@/lib/types";
import type { GuardianDoc } from "@/lib/dto";
import CheckList from "@/components/CheckList";
import BenefitHints from "@/components/BenefitHints";

// 여기에 모든 행동이 모인다. 어르신 화면에는 없는 것들이다.
// 다만 실행 경로가 되는 연락처·링크는 레지스트리 값만 쓴다 — 문서에서 읽은 값은 표시만 한다.
// 부모님 우편물 원문을 보는 화면이라 암구호가 필요하다.

const LIST_MS = 3000;
const DETAIL_MS = 3000;

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

// 화면 표시용. 검증 계층과 같은 문법만 허용한다 — "1,,,,2원" 이 "12원" 으로 보이면 안 된다.
function money(v: unknown): string | null {
  if (typeof v === "number") {
    return Number.isSafeInteger(v) && v >= 0 ? `${v.toLocaleString("ko-KR")}원` : null;
  }
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/원$/, "");
  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(s)) return null;
  return `${Number(s.replace(/,/g, "")).toLocaleString("ko-KR")}원`;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

type Auth = "checking" | "need-login" | "ok" | "unconfigured";

export default function Guardian() {
  const [auth, setAuth] = useState<Auth>("checking");
  const [passphrase, setPassphrase] = useState("");
  const [loginError, setLoginError] = useState("");
  const [docs, setDocs] = useState<GuardianDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef<Set<string>>(new Set());
  const listInFlight = useRef(false);

  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/guardian/session", { signal: ac.signal });
        const d = (await r.json()) as { authenticated: boolean; configured: boolean };
        setAuth(!d.configured ? "unconfigured" : d.authenticated ? "ok" : "need-login");
      } catch {
        setAuth("need-login");
      }
    }, 0);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    const r = await fetch("/api/guardian/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    if (r.ok) {
      setPassphrase("");
      setAuth("ok");
    } else {
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      setLoginError(d.error ?? "로그인하지 못했습니다");
    }
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    if (listInFlight.current) return;
    listInFlight.current = true;
    try {
      const res = await fetch("/api/documents", { signal });
      if (res.status === 401) {
        setAuth("need-login");
        return;
      }
      if (!res.ok) return;
      const d = (await res.json()) as { documents?: GuardianDoc[] };
      setDocs(d.documents ?? []);
      setLoaded(true);
    } catch {
      /* 다음 주기에 다시 시도한다 */
    } finally {
      listInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (auth !== "ok") return;
    const ac = new AbortController();
    // 탭이 가려져 있으면 조회하지 않는다.
    const tick = () => {
      if (document.visibilityState === "visible") void load(ac.signal);
    };
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, LIST_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      ac.abort();
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [auth, load]);

  // 목록 API 는 Upstage 를 부르지 않는다. 판정 없는 문서는 여기서 끌어와야
  // 어르신 화면을 닫아도 자녀 화면이 스스로 완료된다.
  // 타이머 하나로 돈다. docs 변화에 반응하면 RTT 마다 재호출하는 tight loop 이 된다.
  useEffect(() => {
    if (auth !== "ok") return;
    const ac = new AbortController();
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const pending = docs.filter(
        (d) => !d.result && d.pipeline_status !== "failed" && !inFlight.current.has(d.id),
      );
      for (const d of pending) {
        inFlight.current.add(d.id);
        fetch(`/api/documents/${d.id}`, { signal: ac.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((next: GuardianDoc | null) => {
            if (next?.id) setDocs((ds) => ds.map((x) => (x.id === next.id ? next : x)));
          })
          .catch(() => {})
          .finally(() => inFlight.current.delete(d.id));
      }
    };
    const t = setInterval(tick, DETAIL_MS);
    return () => {
      ac.abort();
      clearInterval(t);
    };
  }, [auth, docs]);

  async function mark(id: string, resolution: "acknowledged" | "done") {
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      if (res.status === 401) {
        setAuth("need-login");
        return;
      }
      if (!res.ok) return;
      const updated = (await res.json()) as GuardianDoc;
      setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...updated } : d)));
    } catch {
      /* 실패하면 상태를 바꾸지 않는다. 다음 목록 조회가 진실이다 */
    }
  }

  if (auth === "checking") {
    return <main className="mx-auto max-w-2xl p-6 text-neutral-500">확인 중…</main>;
  }

  if (auth === "unconfigured") {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-2 text-2xl font-bold">부모님 우편물</h1>
        <p className="text-neutral-700">
          서버에 자녀 화면 암구호(<code>GUARDIAN_PASSPHRASE</code>)가 설정되지 않았습니다.
        </p>
      </main>
    );
  }

  if (auth === "need-login") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-6">
        <h1 className="mb-1 text-2xl font-bold">부모님 우편물</h1>
        <p className="mb-6 text-sm leading-relaxed text-neutral-500">
          부모님 우편물 내용을 보는 화면입니다. 암구호를 입력해 주세요.
        </p>
        <form onSubmit={login} className="flex flex-col gap-3">
          <input
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="암구호"
            className="rounded-xl border-2 border-neutral-300 px-4 py-3 text-lg"
            required
          />
          <button
            type="submit"
            className="rounded-xl bg-neutral-800 px-4 py-3 text-base font-semibold text-white"
          >
            들어가기
          </button>
          {loginError && <p className="text-sm text-red-700">{loginError}</p>}
        </form>
      </main>
    );
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
                  {d.phrases?.docLabel ??
                    (r ? "우편물" : d.pipeline_status === "failed" ? "처리 실패" : "읽는 중…")}
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

              {r && <BenefitHints result={r} />}

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
                    disabled={d.resolution_status !== "new"}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                      d.resolution_status !== "new"
                        ? "bg-neutral-200 text-neutral-500"
                        : "bg-neutral-800 text-white"
                    }`}
                  >
                    {d.resolution_status === "new" ? "확인함" : "확인됨"}
                  </button>
                  <button
                    onClick={() => mark(d.id, "done")}
                    disabled={d.resolution_status === "done"}
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
