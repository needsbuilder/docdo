"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { GuardianDoc } from "@/lib/dto";
import GuardianCard from "@/components/GuardianCard";
import AppBar from "@/components/AppBar";
import { ArrowSquareOut, Tray, Check } from "@/components/icons";

// 여기에 모든 행동이 모인다. 어르신 화면에는 없는 것들이다.
// 보호자는 이메일+비밀번호로 가입한다. 가입하면 가구 하나와 어르신 초대 링크가 생긴다.
// 어르신은 그 링크를 한 번 열면 계정 없이 이 가구에 묶인다.

const LIST_MS = 3000;
const DETAIL_MS = 3000;

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

  // 에이전트가 돌고 있는 문서는 1초마다 따로 받아 실시간 화면·단계를 그린다.
  useEffect(() => {
    if (auth !== "ok") return;
    const running = docs.filter((d) => d.action_status === "running" || d.action_status === "queued" || d.action_status === "waiting");
    if (!running.length) return;
    const ac = new AbortController();
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      for (const d of running) {
        fetch(`/api/documents/${d.id}`, { signal: ac.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((next: GuardianDoc | null) => {
            if (next?.id) setDocs((ds) => ds.map((x) => (x.id === next.id ? next : x)));
          })
          .catch(() => {});
      }
    }, 1000);
    return () => {
      ac.abort();
      clearInterval(t);
    };
  }, [auth, docs]);

  async function sendInput(id: string, input: Record<string, unknown>) {
    try {
      await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
    } catch {
      /* 다음 폴링이 진실이다 */
    }
  }

  async function approve(id: string) {
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (res.status === 401) return setAuth("anon");
      if (!res.ok) return;
      const updated = (await res.json()) as GuardianDoc;
      setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...updated } : d)));
    } catch {
      /* 다음 목록 조회가 진실이다 */
    }
  }

  async function mark(id: string, resolution: "acknowledged" | "done") {
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
    <AppBar
      right={
        me ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-g-meta text-surface/75">{me.email}</span>
            <button type="button" onClick={logout} className="on-brand min-h-tap shrink-0 rounded-control px-3 text-g-meta font-bold text-surface">
              로그아웃
            </button>
          </div>
        ) : undefined
      }
    />
  );

  if (auth === "checking") {
    return (
      <main className="mx-auto max-w-2xl px-5 pb-8">
        {Header}
        <p className="mt-6 text-g-body text-ink-soft">확인 중…</p>
      </main>
    );
  }

  if (auth === "unconfigured") {
    return (
      <main className="mx-auto max-w-2xl px-5 pb-8">
        {Header}
        <p className="mt-6 text-g-body text-ink-mid">
          서버에 <code>AUTH_SECRET</code> 이 설정되지 않았습니다.
        </p>
      </main>
    );
  }

  if (auth === "anon") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8">
        {Header}
        <section className="mt-8">
          <h1 className="text-balance text-[1.75rem] font-bold leading-[1.3] tracking-[-0.01em] text-ink">
            부모님 우편물을
            <br />
            대신 확인합니다
          </h1>
          <p className="mt-3 text-g-body text-ink-mid">
            부모님이 찍은 우편물이 여기로 옵니다. 읽은 내용, 공식 정보와 대조한 결과, 확인이 필요한 항목을 한 번에 봅니다.
          </p>
        </section>
        <div className="mt-8 mb-5 flex border-b-2 border-ink" role="tablist">
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
              className={`min-h-tap flex-1 text-g-body font-bold ${
                mode === m ? "-mb-0.5 border-b-4 border-brand text-brand" : "text-ink-soft"
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
          <label htmlFor="password" className="mt-1 text-g-body font-bold text-ink">
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
            className="press on-brand mt-3 min-h-[3.5rem] rounded-control bg-brand px-4 text-g-title text-surface active:bg-brand-deep disabled:opacity-60"
          >
            {busy ? "처리 중…" : mode === "signup" ? "가입하고 링크 만들기" : "로그인"}
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
    <main className="mx-auto max-w-2xl px-5 pb-8">
      {Header}

      <div className="mt-6 mb-5 flex items-end justify-between gap-4">
        <h1 className="text-[1.75rem] font-bold leading-[1.3] tracking-[-0.01em] text-ink">부모님 우편물</h1>
        {docs.length > 0 && (
          <p className="text-g-meta tabular-nums text-ink-mid">
            확인 필요 <strong className="text-g-body text-ink">{attention}</strong> · 전체 <strong className="text-g-body text-ink">{docs.length}</strong>
          </p>
        )}
      </div>

      {/* 어르신 초대 링크. 한 번만 보내면 된다 — 어르신 폰에 저장된다. */}
      <section className="mb-6 rounded-card bg-well p-5">
        <h2 className="text-g-body font-bold text-ink">부모님 폰에 보낼 링크</h2>
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

      <div className="space-y-5">
        {docs.map((d) => (
          <GuardianCard key={d.id} doc={d} onMark={mark} onApprove={approve} onInput={sendInput} />
        ))}

        {loaded && docs.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-card bg-well px-6 py-12 text-center">
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
