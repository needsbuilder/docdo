"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { GuardianDoc } from "@/lib/dto";
import GuardianCard from "@/components/GuardianCard";
import AppBar from "@/components/AppBar";
import { Tray, Check, Share } from "@/components/icons";

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
  // 시안(문서함)의 상태 칩. 클라이언트 필터 — 목록 API 는 그대로.
  const [filter, setFilter] = useState<"all" | "attention" | "done">("all");
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
      // 목록은 경량판(화면 없음). 실행 중 문서는 1초 폴링이 가져온 화면·트레이스를 지키며 합친다.
      setDocs((prev) =>
        (d.documents ?? []).map((n) => {
          const old = prev.find((x) => x.id === n.id);
          const active = n.action_status === "running" || n.action_status === "waiting" || n.action_status === "queued";
          return old && active ? { ...n, action_trace: old.action_trace?.length >= (n.action_trace?.length ?? 0) ? old.action_trace : n.action_trace, action_live: old.action_live } : n;
        }),
      );
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

  // 에이전트가 돌고 있는 문서는 따로 받아 실시간 화면·단계를 그린다. 보호자 차례(waiting)면 더 자주.
  useEffect(() => {
    if (auth !== "ok") return;
    const running = docs.filter((d) => d.action_status === "running" || d.action_status === "queued" || d.action_status === "waiting");
    if (!running.length) return;
    const ac = new AbortController();
    const period = running.some((d) => d.action_status === "waiting") ? 400 : 1000;
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
    }, period);
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
      // 워커가 반영한 화면을 주기 전에 한 번 당겨 받는다.
      setTimeout(() => {
        fetch(`/api/documents/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((next: GuardianDoc | null) => {
            if (next?.id) setDocs((ds) => ds.map((x) => (x.id === next.id ? next : x)));
          })
          .catch(() => {});
      }, 450);
    } catch {
      /* 다음 폴링이 진실이다 */
    }
  }

  async function approve(id: string, site: "demo" | "giro" = "demo") {
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", site }),
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
      back="/"
      title={auth === "ok" ? "부모님 우편물" : mode === "signup" ? "가입하기" : "로그인"}
      right={
        me ? (
          <button type="button" onClick={logout} className="min-h-tap shrink-0 rounded-inner px-2 text-g-meta font-bold text-ink-soft active:bg-well">
            로그아웃
          </button>
        ) : undefined
      }
    />
  );

  if (auth === "checking") {
    return (
      <main className="mx-auto max-w-2xl px-6 pb-8">
        {Header}
        <p className="mt-6 text-g-body text-ink-soft">확인 중…</p>
      </main>
    );
  }

  if (auth === "unconfigured") {
    return (
      <main className="mx-auto max-w-2xl px-6 pb-8">
        {Header}
        <p className="mt-6 text-g-body text-ink-mid">
          서버에 <code>AUTH_SECRET</code> 이 설정되지 않았습니다.
        </p>
      </main>
    );
  }

  if (auth === "anon") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-8">
        {Header}
        {/* 시안(자녀 가입): 30px 2줄 헤드라인 + 회색 부제 + 라벨 + 64px 입력 + 56px 전폭 CTA. */}
        <section className="mt-6">
          <h2 className="text-balance text-g-h1 text-ink">
            부모님 우편물을
            <br />
            대신 확인합니다
          </h2>
          <p className="mt-3 text-g-body text-ink-soft">
            부모님이 찍은 우편물이 여기로 옵니다. 읽은 내용, 공식 정보와 대조한 결과, 확인이 필요한 항목을 한 번에 봅니다.
          </p>
        </section>
        <div className="mt-7 mb-6 flex rounded-control bg-well p-1" role="tablist">
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
              className={`press min-h-tap flex-1 rounded-[14px] text-g-body font-bold ${
                mode === m ? "bg-surface text-ink shadow-card" : "text-ink-soft"
              }`}
            >
              {m === "login" ? "로그인" : "가입"}
            </button>
          ))}
        </div>
        <form onSubmit={submitAuth} className="flex flex-col gap-2">
          <label htmlFor="email" className="text-g-meta font-bold text-ink">
            이메일
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-16 rounded-control border-[1.5px] border-line bg-surface px-4 text-g-title font-normal text-ink focus:border-brand"
            required
          />
          <label htmlFor="password" className="mt-3 text-g-meta font-bold text-ink">
            비밀번호 <span className="font-normal text-ink-soft">(8자 이상)</span>
          </label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            className="min-h-16 rounded-control border-[1.5px] border-line bg-surface px-4 text-g-title font-normal text-ink focus:border-brand"
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="press on-brand mt-5 min-h-cta rounded-control bg-brand-deep px-4 text-g-title text-surface active:bg-brand-press disabled:opacity-60"
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
  const isDone = (d: GuardianDoc) => d.resolution_status === "done" || d.action_status === "done";
  const shown = docs.filter((d) =>
    filter === "all" ? true : filter === "done" ? isDone(d) : !!d.result && NEEDS_ATTENTION.has(d.verdict ?? "") && !isDone(d),
  );

  return (
    <main className="mx-auto max-w-2xl px-6 pb-8">
      {Header}

      <div className="mt-5 mb-4">
        <h2 className="text-g-h1 text-ink">부모님 우편물</h2>
        {docs.length > 0 && (
          <p className="mt-1 text-g-meta tabular-nums text-ink-soft">
            받은 우편물 {docs.length}개 · 확인 필요 <strong className="text-ink">{attention}</strong>개
          </p>
        )}
      </div>

      {/* 시안(문서함)의 상태 칩. */}
      {docs.length > 0 && (
        <div className="mb-4 flex gap-2" role="tablist" aria-label="상태">
          {(
            [
              ["all", "전체"],
              ["attention", "확인 필요"],
              ["done", "처리됨"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={filter === k}
              onClick={() => setFilter(k)}
              className={`press min-h-10 rounded-chip px-4 text-g-meta font-bold ${
                filter === k ? "bg-brand-tint text-brand-deep" : "bg-surface text-ink-soft shadow-card"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 어르신 초대 링크(시안 07A). 우편물이 한 건이라도 왔으면 부모님 폰이 연결된 것 — 그 뒤로는 맨 아래 한 줄로 줄인다. */}
      {docs.length === 0 && (
        <section className="mb-6">
          <h3 className="text-g-h1 text-ink">
            부모님께 초대 링크를
            <br />
            보내주세요
          </h3>
          <p className="mt-2 text-g-body text-ink-soft">부모님이 이 링크를 한 번 열어 두시면, 그 뒤로는 가입 없이 찍은 우편물이 여기로 옵니다.</p>
          <div className="mt-5 flex items-center gap-3 rounded-card bg-surface p-4 shadow-card">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-inner bg-brand-tint text-brand-deep">
              <Share size={24} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-g-body font-bold text-ink">초대 링크 보내기</span>
              <span className="block text-g-meta text-ink-soft">문자나 카카오톡으로 보낼 수 있어요</span>
            </span>
          </div>
          <button
            type="button"
            onClick={shareLink}
            className="press on-brand mt-3 inline-flex min-h-cta w-full items-center justify-center gap-2 rounded-control bg-brand-deep px-4 text-g-title text-surface active:bg-brand-press"
          >
            {copied ? <Check size={20} /> : <Share size={20} />}
            {copied ? "링크를 복사했어요" : "부모님께 초대 링크 보내기"}
          </button>
          <code className="mt-2 block break-all text-g-meta text-ink-soft">{elderLink}</code>
        </section>
      )}

      <div className="space-y-4">
        {shown.map((d) => (
          <GuardianCard key={d.id} doc={d} onMark={mark} onApprove={approve} onInput={sendInput} />
        ))}

        {docs.length > 0 && shown.length === 0 && (
          <p className="rounded-card bg-surface px-5 py-8 text-center text-g-body text-ink-soft shadow-card">이 상태의 우편물이 없습니다.</p>
        )}

        {docs.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-g-meta text-ink-soft">
            부모님 폰이 연결돼 있습니다.
            <button type="button" onClick={shareLink} className="press min-h-tap rounded-inner px-1 font-bold text-brand-deep active:bg-brand-tint">
              {copied ? "복사됨" : "링크 다시 보내기"}
            </button>
          </p>
        )}

        {loaded && docs.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-12 text-center shadow-card">
            <span className="flex size-[4.5rem] items-center justify-center rounded-inner bg-brand-tint text-brand-deep">
              <Tray size={40} />
            </span>
            <p className="text-g-title text-ink">아직 받은 우편물이 없습니다</p>
            <p className="text-g-body text-ink-soft">위 링크를 부모님께 보내고, 부모님이 사진을 찍으면 여기에 올라옵니다.</p>
            <Link href={`/elder?h=${me?.elderToken ?? ""}`} className="mt-2 min-h-tap text-g-body font-bold text-brand-deep underline underline-offset-4">
              이 폰에서 어르신 화면 열어보기
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
