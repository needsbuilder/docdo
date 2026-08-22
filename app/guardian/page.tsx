"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VERDICT_LABEL } from "@/lib/verify";
import type { Verdict } from "@/lib/types";
import type { GuardianDoc } from "@/lib/dto";
import CheckList from "@/components/CheckList";
import BenefitHints from "@/components/BenefitHints";
import { Phone, ArrowSquareOut, Tray, Envelope, Check } from "@/components/icons";

// 여기에 모든 행동이 모인다. 어르신 화면에는 없는 것들이다.
// 보호자는 이메일+비밀번호로 가입한다. 가입하면 가구 하나와 어르신 초대 링크가 생긴다.
// 어르신은 그 링크를 한 번 열면 계정 없이 이 가구에 묶인다.

const LIST_MS = 3000;
const DETAIL_MS = 3000;

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

type Auth = "checking" | "anon" | "ok" | "unconfigured";
type Me = { email: string; elderToken: string };

export default function Guardian() {
  const [auth, setAuth] = useState<Auth>("checking");
  const [me, setMe] = useState<Me | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [docs, setDocs] = useState<GuardianDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [confirmDone, setConfirmDone] = useState<string | null>(null);
  const inFlight = useRef<Set<string>>(new Set());
  const listInFlight = useRef(false);

  const refreshMe = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch("/api/guardian/session", { signal });
      const d = (await r.json()) as {
        authenticated: boolean;
        configured: boolean;
        email?: string;
        elderToken?: string;
      };
      if (!d.configured) return setAuth("unconfigured");
      if (d.authenticated && d.email && d.elderToken) {
        setMe({ email: d.email, elderToken: d.elderToken });
        setAuth("ok");
      } else {
        setMe(null);
        setAuth("anon");
      }
    } catch {
      setAuth("anon");
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => refreshMe(ac.signal), 0);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [refreshMe]);

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setBusy(true);
    try {
      const r = await fetch(mode === "signup" ? "/api/guardian/signup" : "/api/guardian/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (r.ok) {
        setPassword("");
        await refreshMe();
      } else {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setFormError(d.error ?? "처리하지 못했습니다");
      }
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/guardian/session", { method: "DELETE" });
    setMe(null);
    setDocs([]);
    setLoaded(false);
    setAuth("anon");
  }

  const elderLink = me ? `${typeof window !== "undefined" ? window.location.origin : ""}/elder?h=${me.elderToken}` : "";

  async function shareLink() {
    if (!elderLink) return;
    const data = { title: "독도 — 우편물 읽어드리기", text: "이 링크를 한 번 열어 두시면 돼요.", url: elderLink };
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
        await navigator.share(data);
        return;
      }
    } catch {
      /* 공유 취소. 복사로 넘어간다 */
    }
    try {
      await navigator.clipboard.writeText(elderLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFormError("복사하지 못했습니다. 링크를 길게 눌러 복사해 주세요.");
    }
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    if (listInFlight.current) return;
    listInFlight.current = true;
    try {
      const res = await fetch("/api/documents", { signal });
      if (res.status === 401) {
        setAuth("anon");
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
  // 어르신 화면을 닫아도 보호자 화면이 스스로 완료된다. 타이머 하나로 돈다.
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
        setAuth("anon");
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
    <header className="mb-6 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 text-brand">
        <Envelope size={28} />
        <h1 className="text-g-title text-ink">부모님 우편물</h1>
      </div>
      {me && (
        <button type="button" onClick={logout} className="press min-h-tap rounded-control px-3 text-g-meta text-ink-soft active:bg-brand-tint">
          로그아웃
        </button>
      )}
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
          서버에 <code>AUTH_SECRET</code> 이 설정되지 않았습니다.
        </p>
      </main>
    );
  }

  if (auth === "anon") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-8">
        {Header}
        <p className="mb-6 text-g-body text-ink-mid">
          부모님 우편물을 대신 확인하는 화면입니다. 가입하면 부모님께 보낼 링크가 만들어집니다.
        </p>
        <div className="mb-4 flex rounded-control border-2 border-line bg-surface p-1" role="tablist">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setFormError("");
              }}
              className={`press min-h-tap flex-1 rounded-inner text-g-body font-bold ${
                mode === m ? "bg-brand text-surface" : "text-ink-mid"
              }`}
            >
              {m === "login" ? "로그인" : "가입"}
            </button>
          ))}
        </div>
        <form onSubmit={submitAuth} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-g-body font-bold text-ink">
            이메일
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-tap rounded-control border-2 border-line bg-surface px-4 text-g-title text-ink"
            required
          />
          <label htmlFor="password" className="text-g-body font-bold text-ink">
            비밀번호 <span className="font-normal text-ink-soft">(8자 이상)</span>
          </label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            className="min-h-tap rounded-control border-2 border-line bg-surface px-4 text-g-title text-ink"
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="press on-brand mt-2 min-h-tap rounded-control border-2 border-brand bg-brand px-4 text-g-body font-bold text-surface active:bg-brand-deep disabled:opacity-60"
          >
            {busy ? "처리 중…" : mode === "signup" ? "가입하고 시작하기" : "로그인"}
          </button>
          {formError && (
            <p className="text-g-body text-danger-ink" aria-live="polite">
              {formError}
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

      {/* 어르신 초대 링크. 한 번만 보내면 된다 — 어르신 폰에 저장된다. */}
      <section className="mb-6 rounded-card border-2 border-brand bg-brand-tint p-5">
        <h2 className="text-g-body font-bold text-brand">부모님 폰에 보낼 링크</h2>
        <p className="mt-1 text-g-body text-ink-mid">
          부모님이 이 링크를 한 번 열어 두시면, 그 뒤로는 가입 없이 찍은 우편물이 여기로 옵니다.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={shareLink}
            className="press on-brand inline-flex min-h-tap items-center gap-2 rounded-control border-2 border-brand bg-brand px-4 text-g-body font-bold text-surface active:bg-brand-deep"
          >
            {copied ? <Check size={20} /> : <ArrowSquareOut size={18} />}
            {copied ? "복사됨" : "링크 보내기"}
          </button>
          <code className="min-w-0 break-all text-g-meta text-ink-soft">{elderLink}</code>
        </div>
      </section>

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
                        완료로 표시할까요? 부모님 화면도 바뀝니다.
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
            <p className="text-g-body text-ink-mid">위 링크를 부모님께 보내고, 부모님이 사진을 찍으면 여기에 올라옵니다.</p>
            <Link href={`/elder?h=${me?.elderToken ?? ""}`} className="mt-2 text-g-body font-bold text-brand underline underline-offset-4">
              이 폰에서 어르신 화면 열어보기
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
