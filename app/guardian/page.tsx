"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VERDICT_LABEL } from "@/lib/verify";
import type { Verdict } from "@/lib/types";
import type { GuardianDoc } from "@/lib/dto";
import CheckList from "@/components/CheckList";
import BenefitHints from "@/components/BenefitHints";
import { Phone, ArrowSquareOut, Tray, Envelope } from "@/components/icons";

// 여기에 모든 행동이 모인다. 어르신 화면에는 없는 것들이다.
// 다만 실행 경로가 되는 연락처·링크는 레지스트리 값만 쓴다 — 문서에서 읽은 값은 표시만 한다.
// 부모님 우편물 원문을 보는 화면이라 암구호가 필요하다.

const LIST_MS = 3000;
const DETAIL_MS = 3000;

// 판정 색은 테두리로. amber-400(1.67:1) 같은 값은 저시력에 보이지 않는다.
const TONE: Record<string, string> = {
  mismatch: "border-danger bg-danger-tint",
  review: "border-warn bg-warn-tint",
  unknown_issuer: "border-line bg-surface",
  needs_human: "border-line bg-surface",
  not_checkable: "border-line bg-surface",
  failed: "border-line-soft bg-surface",
  no_extract: "border-line-soft bg-surface",
  clear: "border-line bg-surface",
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

const NEEDS_ATTENTION = new Set(["mismatch", "review", "unknown_issuer", "needs_human", "not_checkable"]);

type Auth = "checking" | "need-login" | "ok" | "unconfigured";

export default function Guardian() {
  const [auth, setAuth] = useState<Auth>("checking");
  const [passphrase, setPassphrase] = useState("");
  const [loginError, setLoginError] = useState("");
  const [docs, setDocs] = useState<GuardianDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  // 되돌릴 수 없는 동작(어르신 화면까지 바뀐다)은 한 번 더 묻는다. 모달·길게누르기 아님.
  const [confirmDone, setConfirmDone] = useState<string | null>(null);
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
  // 어르신 화면을 닫아도 자녀 화면이 스스로 완료된다. 타이머 하나로 돈다.
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
    setConfirmDone(null);
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

  const Header = (
    <header className="mb-6 flex items-center gap-3 text-brand">
      <Envelope size={28} />
      <h1 className="text-g-title text-ink">부모님 우편물</h1>
    </header>
  );

  if (auth === "checking") {
    return (
      <main className="mx-auto max-w-2xl px-5 py-8">
        {Header}
        <p className="text-g-body text-ink-soft">확인 중…</p>
      </main>
    );
  }

  if (auth === "unconfigured") {
    return (
      <main className="mx-auto max-w-2xl px-5 py-8">
        {Header}
        <p className="text-g-body text-ink-mid">
          서버에 자녀 화면 암구호(<code>GUARDIAN_PASSPHRASE</code>)가 설정되지 않았습니다.
        </p>
      </main>
    );
  }

  if (auth === "need-login") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-8">
        {Header}
        <p className="mb-6 text-g-body text-ink-mid">
          부모님 우편물 내용을 보는 화면입니다. 암구호를 입력해 주세요.
        </p>
        <form onSubmit={login} className="flex flex-col gap-3">
          <label htmlFor="passphrase" className="text-g-body font-bold text-ink">
            암구호
          </label>
          <input
            id="passphrase"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="min-h-tap rounded-control border-2 border-line bg-surface px-4 text-g-title text-ink"
            required
          />
          <button
            type="submit"
            className="press on-brand min-h-tap rounded-control border-2 border-brand bg-brand px-4 text-g-body font-bold text-surface active:bg-brand-deep"
          >
            들어가기
          </button>
          {loginError && (
            <p className="text-g-body text-danger-ink" aria-live="polite">
              {loginError}
            </p>
          )}
        </form>
      </main>
    );
  }

  const attention = docs.filter((d) => d.result && NEEDS_ATTENTION.has(d.verdict ?? "") && d.resolution_status !== "done").length;

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      {Header}
      {docs.length > 0 && (
        <p className="mb-5 text-g-body tabular-nums text-ink-mid">
          확인 필요 <strong className="text-ink">{attention}</strong> · 전체 <strong className="text-ink">{docs.length}</strong>
        </p>
      )}

      <div className="space-y-5">
        {docs.map((d) => {
          const r = d.result;
          const f = (r?.fields ?? {}) as Record<string, unknown>;
          const amount = money(f.amount_krw);
          const issuer = text(f.issuer);
          const due = text(f.due_date) ?? text(f.apply_deadline);
          const officialPhone = r?.safeContact?.phones?.[0];
          const officialHost = r?.safeContact?.hosts?.[0];
          const title = d.phrases?.docLabel ?? (r ? "우편물" : d.pipeline_status === "failed" ? "처리 실패" : "읽는 중…");

          return (
            <article
              key={d.id}
              className={`rounded-card border-2 p-5 shadow-card ${TONE[d.verdict ?? ""] ?? "border-line-soft bg-surface"}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="min-w-0 text-g-title text-ink">{title}</h2>
                {d.verdict && (
                  <span className="shrink-0 text-g-body font-bold text-ink-mid">
                    {VERDICT_LABEL[d.verdict as Verdict]}
                  </span>
                )}
              </div>

              {r && (issuer || amount || due) && (
                <p className="mt-1 text-g-body text-ink-mid">
                  {[issuer, amount, due && `${due}까지`].filter(Boolean).join(" · ")}
                </p>
              )}

              {r && (
                <div className="mt-4">
                  <CheckList result={r} />
                </div>
              )}

              {r && <BenefitHints result={r} />}

              {r?.reasons && r.reasons.length > 0 && (
                <ul className="mt-4 space-y-2 text-g-body">
                  {r.reasons.map((x, i) => {
                    const soft = x.rule === "R3" || x.rule === "R5";
                    return (
                      <li key={i} className={soft ? "text-ink-mid" : "text-danger-ink"}>
                        {x.detail}
                        <span className="text-ink-soft"> → {x.action}</span>
                        <span className="ml-2 rounded-chip bg-paper px-1.5 py-0.5 font-mono text-g-meta text-ink-soft">
                          {x.rule}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* 실행 경로는 레지스트리 값만. 문서에서 읽은 번호·링크는 링크가 되지 않는다. */}
              {r && (officialPhone || officialHost) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {officialPhone && (
                    <a
                      href={`tel:${officialPhone}`}
                      className="press inline-flex min-h-tap items-center gap-2 rounded-control border-2 border-line bg-surface px-3 text-g-body font-bold text-ink active:bg-brand-tint"
                    >
                      <Phone size={20} />
                      공식 대표번호 {officialPhone}
                    </a>
                  )}
                  {officialHost && (
                    <a
                      href={`https://${officialHost}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="press inline-flex min-h-tap items-center gap-2 rounded-control border-2 border-line bg-surface px-3 text-g-body text-ink active:bg-brand-tint"
                    >
                      <ArrowSquareOut size={18} />
                      공식 사이트
                    </a>
                  )}
                </div>
              )}

              {r && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {confirmDone === d.id ? (
                    <>
                      <span className="flex min-h-tap items-center text-g-body text-ink">
                        완료로 표시할까요? 어르신 화면도 바뀝니다.
                      </span>
                      <button
                        type="button"
                        onClick={() => mark(d.id, "done")}
                        className="press on-brand min-h-tap rounded-control border-2 border-brand bg-brand px-4 text-g-body font-bold text-surface active:bg-brand-deep"
                      >
                        완료
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDone(null)}
                        className="press min-h-tap rounded-control border-2 border-line bg-surface px-4 text-g-body text-ink active:bg-brand-tint"
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => mark(d.id, "acknowledged")}
                        disabled={d.resolution_status !== "new"}
                        className="press min-h-tap rounded-control border-2 border-line bg-surface px-4 text-g-body font-bold text-ink active:bg-brand-tint disabled:border-line-soft disabled:text-ink-soft"
                      >
                        {d.resolution_status === "new" ? "확인함" : "확인됨"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDone(d.id)}
                        disabled={d.resolution_status === "done"}
                        className={`press min-h-tap rounded-control border-2 px-4 text-g-body font-bold ${
                          d.resolution_status === "done"
                            ? "border-ok bg-ok-tint text-ok-ink"
                            : "on-brand border-brand bg-brand text-surface active:bg-brand-deep"
                        }`}
                      >
                        {d.resolution_status === "done" ? "처리 완료됨" : "처리 완료"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}

        {loaded && docs.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-card border-2 border-line-soft bg-surface px-6 py-12 text-center">
            <span className="text-ink-soft">
              <Tray size={48} />
            </span>
            <p className="text-g-title text-ink">아직 받은 우편물이 없습니다</p>
            <p className="text-g-body text-ink-mid">어르신이 사진을 찍으면 여기에 올라옵니다.</p>
            <Link href="/elder" className="mt-2 text-g-body font-bold text-brand underline underline-offset-4">
              어르신 화면 열기
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
