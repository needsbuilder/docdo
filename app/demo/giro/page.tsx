"use client";

import { useState } from "react";

// 시연용 납부 포털. 인터넷지로의 화면 흐름(전자납부번호 → 조회 → 납부수단 → 납부)을 흉내 낸다.
// 에이전트 워커가 이 화면을 실제 브라우저(900×640)로 조작하고, 그 화면이 보호자 폰에 실시간으로 송출된다.
// 화면 어디에나 "시연용"이 보이게 둔다.
//
// ⚠ 워커와의 계약 — 바꾸면 scripts/agent-worker.ts 도 같이 바꾼다.
//   id: epn · lookup · error · bill · bill-issuer · bill-title · bill-payer · bill-due · bill-amount
//       method-card · method-account · pay · auth · pin-dots · k0~k9 · auth-del · auth-ok · receipt · receipt-no
//   워커의 HUMAN 정규식(비밀번호·인증서·본인인증·보안 키패드·OTP·공동인증·금융인증·간편인증)은 페이지 본문 전체를 본다.
//   → 이 단어들은 #auth 안에서만 쓴다. 그 밖(머리말·안내·꼬리말)에 쓰면 에이전트가 조회 전에 멈춘다.

type Bill = { epn: string; issuer: string; title: string; amount: number; due: string; payer: string };
type Method = "card" | "account";

const NAV = ["지방세입", "국고금", "사회보험료", "전기·수신료", "납부내역"];
const STEPS = ["번호 조회", "내역 확인", "납부수단", "직접 확인", "납부 완료"];
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const dateKo = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
};

export default function DemoGiro() {
  const [epn, setEpn] = useState("");
  const [bill, setBill] = useState<Bill | null>(null);
  const [err, setErr] = useState("");
  const [method, setMethod] = useState<Method>("card");
  const [receipt, setReceipt] = useState<{ receipt: string; paidAt: string; method: Method } | null>(null);
  // 직접 확인 단계 흉내. 실제 인증서 PIN 처럼 6자리를 키패드로 받는다(어떤 숫자든 통과). 에이전트는 이 화면을 넘지 못한다.
  const [authing, setAuthing] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const stage = receipt ? 4 : authing ? 3 : bill ? 1 : 0;

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBill(null);
    setReceipt(null);
    setAuthing(false);
    if (!epn.trim()) return setErr("전자납부번호를 입력해 주세요");
    setBusy(true);
    try {
      const r = await fetch(`/api/demo/giro?epn=${encodeURIComponent(epn)}`);
      if (!r.ok) return setErr("전자납부번호를 찾을 수 없습니다");
      setBill(((await r.json()) as { bill: Bill }).bill);
    } finally {
      setBusy(false);
    }
  }
  function startAuth() {
    setAuthing(true);
    setPin("");
  }
  async function pay() {
    if (!bill || pin.length !== 6) return;
    setAuthing(false);
    const r = await fetch("/api/demo/giro", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ epn: bill.epn, method }) });
    if (r.ok) {
      const d = (await r.json()) as { receipt: string; paidAt: string };
      setReceipt({ ...d, method });
    }
  }
  function reset() {
    setEpn("");
    setBill(null);
    setErr("");
    setReceipt(null);
    setAuthing(false);
    setPin("");
  }

  return (
    <div className="min-h-dvh bg-[#eef1f5] text-[#1b2430]" style={{ fontFamily: "system-ui, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif", wordBreak: "keep-all" }}>
      {/* 유틸리티 바 */}
      <div className="border-b border-[#dfe4ea] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-1.5 text-[12px] text-[#5b6776]">
          <span>공과금·세금 통합납부 시연 환경</span>
          <span className="flex items-center gap-3">
            <span className="rounded-full border border-[#e0424e] bg-[#fff2f3] px-2.5 py-0.5 font-bold text-[#c62f3b]">시연용 · 실제 납부 아님</span>
            <span className="hidden sm:inline">고객센터 1588-0000 (가상)</span>
          </span>
        </div>
      </div>

      {/* 헤더 */}
      <header className="bg-white shadow-[0_1px_0_#dfe4ea]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-[#123a69] text-[15px] font-black tracking-tight text-white">GIRO</span>
            <div className="leading-tight">
              <div className="text-[18px] font-extrabold text-[#123a69]">통합납부 포털</div>
              <div className="text-[11px] text-[#7a8796]">Integrated Payment Portal · DEMO</div>
            </div>
          </div>
          <nav className="hidden items-center gap-6 text-[14px] font-semibold text-[#3c4754] md:flex">
            {NAV.map((n, i) => (
              <span key={n} className={i === 0 ? "border-b-2 border-[#1b64da] pb-0.5 text-[#1b64da]" : ""}>
                {n}
              </span>
            ))}
          </nav>
        </div>
      </header>

      {/* 히어로 + 조회 */}
      <section className="bg-[linear-gradient(135deg,#123a69_0%,#1b64da_100%)] text-white">
        <div className="mx-auto max-w-5xl px-5 pb-8 pt-7">
          <h1 className="text-[22px] font-extrabold leading-snug md:text-[26px]">전자납부번호 하나로, 조회부터 납부까지</h1>
          <p className="mt-1 text-[13px] text-white/80">고지서 하단의 전자납부번호(납부자번호)를 입력하면 고지 내역을 바로 확인할 수 있습니다.</p>

          <form onSubmit={lookup} className="mt-5 rounded-xl bg-white p-4 text-[#1b2430] shadow-[0_10px_30px_rgba(10,30,60,0.25)] md:p-5">
            <div className="mb-3 flex gap-5 border-b border-[#e6eaf0] text-[14px] font-bold">
              <span className="-mb-px border-b-2 border-[#1b64da] pb-2 text-[#1b64da]">전자납부번호 조회</span>
              <span className="pb-2 text-[#9aa5b3]">납세자번호 조회</span>
            </div>
            <label htmlFor="epn" className="text-[13px] font-semibold text-[#3c4754]">
              전자납부번호
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="epn"
                name="epn"
                value={epn}
                onChange={(e) => setEpn(e.target.value)}
                placeholder="예) 1102-1234-5678-9012"
                inputMode="numeric"
                autoComplete="off"
                className="h-12 min-w-0 flex-1 rounded-lg border border-[#c9d1db] bg-white px-3.5 text-[16px] tabular-nums tracking-wide outline-none focus:border-[#1b64da] focus:ring-2 focus:ring-[#1b64da]/25"
              />
              <button id="lookup" type="submit" disabled={busy} className="h-12 shrink-0 rounded-lg bg-[#1b64da] px-6 text-[15px] font-bold text-white hover:bg-[#1552b8] disabled:opacity-60">
                {busy ? "조회 중…" : "조회"}
              </button>
            </div>
            <p className="mt-2 text-[12px] text-[#7a8796]">숫자만 입력해도 됩니다. 하이픈(-)은 있어도 없어도 같습니다.</p>
            {err && (
              <p id="error" className="mt-3 flex items-center gap-2 rounded-lg bg-[#fff2f3] px-3 py-2 text-[13px] font-semibold text-[#c62f3b]">
                <span aria-hidden="true" className="inline-flex size-4 items-center justify-center rounded-full bg-[#c62f3b] text-[11px] text-white">!</span>
                {err}
              </p>
            )}
          </form>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-5 pb-14 pt-6">
        {/* 진행 단계 */}
        <ol className="mb-6 grid grid-cols-5 gap-1 text-center text-[12px] font-semibold">
          {STEPS.map((s, i) => {
            const on = i <= stage;
            return (
              <li key={s} className="flex flex-col items-center gap-1.5">
                <span className={`flex size-7 items-center justify-center rounded-full text-[12px] ${i === stage ? "bg-[#1b64da] text-white" : on ? "bg-[#dbe8fb] text-[#1b64da]" : "bg-[#e3e8ee] text-[#8a95a3]"}`}>{i + 1}</span>
                <span className={on ? "text-[#1b2430]" : "text-[#9aa5b3]"}>{s}</span>
              </li>
            );
          })}
        </ol>

        {!bill && !err && (
          <section className="grid gap-3 md:grid-cols-3">
            {[
              ["전자납부번호", "고지서 하단 납부서의 19~20자리 숫자입니다."],
              ["납부 가능 시간", "평일·주말 00:30 ~ 23:30 (시연 환경은 상시)"],
              ["수수료", "신용카드·계좌이체 모두 납부자 수수료 없음"],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl border border-[#e3e8ee] bg-white p-4">
                <p className="text-[13px] font-bold text-[#123a69]">{t}</p>
                <p className="mt-1 text-[13px] text-[#5b6776]">{d}</p>
              </div>
            ))}
          </section>
        )}

        {bill && !receipt && (
          <section id="bill" className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
            {/* 고지 내역 */}
            <div className="rounded-xl border border-[#e3e8ee] bg-white">
              <h2 className="border-b border-[#e6eaf0] px-5 py-3.5 text-[15px] font-extrabold">고지 내역</h2>
              <table className="w-full text-[14px]">
                <tbody>
                  {(
                    [
                      ["기관", "bill-issuer", bill.issuer],
                      ["납부 항목", "bill-title", bill.title],
                      ["납부의무자", "bill-payer", bill.payer],
                      ["납부기한", "bill-due", dateKo(bill.due)],
                      ["전자납부번호", "bill-epn", bill.epn],
                    ] as const
                  ).map(([k, id, v]) => (
                    <tr key={id} className="border-b border-[#f0f2f5] last:border-b-0">
                      <th className="w-32 bg-[#f7f9fb] px-5 py-3 text-left font-semibold text-[#5b6776]">{k}</th>
                      <td id={id} className="px-5 py-3 font-medium tabular-nums">
                        {v}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-[#f3f7fd]">
                    <th className="w-32 px-5 py-3.5 text-left font-semibold text-[#123a69]">납부할 금액</th>
                    <td id="bill-amount" className="px-5 py-3.5 text-[22px] font-extrabold tabular-nums text-[#123a69]">
                      {won(bill.amount)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="px-5 py-3 text-[12px] text-[#7a8796]">납부기한이 지나면 가산금이 더해질 수 있습니다. 기한 내 금액 기준으로 표시됩니다.</p>
            </div>

            {/* 납부 정보 */}
            <div className="flex flex-col rounded-xl border border-[#e3e8ee] bg-white">
              <h2 className="border-b border-[#e6eaf0] px-5 py-3.5 text-[15px] font-extrabold">납부수단</h2>
              <fieldset className="px-5 pt-4">
                <legend className="sr-only">납부수단</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["card", "method-card", "신용카드", "국내 전 카드사"],
                      ["account", "method-account", "계좌이체", "실시간 출금"],
                    ] as const
                  ).map(([val, id, name, sub]) => (
                    <label key={id} htmlFor={id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border-2 p-3 ${method === val ? "border-[#1b64da] bg-[#f3f7fd]" : "border-[#e3e8ee] bg-white"}`}>
                      <input id={id} type="radio" name="method" value={val} checked={method === val} onChange={() => setMethod(val)} className="mt-1 size-4 accent-[#1b64da]" />
                      <span>
                        <span className="block text-[14px] font-bold">{name}</span>
                        <span className="block text-[12px] text-[#7a8796]">{sub}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-2.5 text-[12px] text-[#7a8796]">납부자 수수료 없음 · 납부 후 취소는 기관에 문의</p>
              </fieldset>

              <div className="mt-auto px-5 pb-5 pt-4">
                <div className="flex items-baseline justify-between border-t border-[#e6eaf0] pt-4">
                  <span className="text-[13px] font-semibold text-[#5b6776]">결제 금액</span>
                  <span className="text-[20px] font-extrabold tabular-nums text-[#123a69]">{won(bill.amount)}</span>
                </div>
                {!authing ? (
                  <button id="pay" type="button" onClick={startAuth} className="mt-3 h-12 w-full rounded-lg bg-[#1b64da] text-[16px] font-bold text-white hover:bg-[#1552b8]">
                    {won(bill.amount)} 납부하기
                  </button>
                ) : (
                  <p className="mt-3 rounded-lg bg-[#fff8e6] px-3 py-2 text-[12px] font-semibold text-[#8a5a00]">아래에서 직접 확인 단계를 마치면 납부가 실행됩니다.</p>
                )}
              </div>
            </div>

            {authing && (
              <div id="auth" className="rounded-xl border-2 border-[#1b64da] bg-white p-5 md:col-span-2">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f3f7fd] text-[#1b64da]">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="10" width="16" height="11" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                  </span>
                  <div>
                    <h3 className="text-[16px] font-extrabold">본인인증 · 인증서 비밀번호 6자리</h3>
                    <p className="mt-0.5 text-[13px] text-[#5b6776]">보안 키패드입니다. 납부의무자 본인이 직접 입력해 주세요.</p>
                    <p className="mt-0.5 text-[12px] text-[#9aa5b3]">시연용 — 어떤 숫자든 통과합니다. 실제 인증이 아닙니다.</p>
                  </div>
                </div>
                <p id="pin-dots" className="mt-5 text-center text-[28px] tracking-[0.5em] text-[#123a69]" aria-label={`${pin.length}자리 입력됨`}>
                  {"●".repeat(pin.length)}
                  <span className="text-[#c9d1db]">{"○".repeat(6 - pin.length)}</span>
                </p>
                <div className="mx-auto mt-4 grid w-72 grid-cols-3 gap-2">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "지움", "0", "확인"].map((k) => (
                    <button
                      key={k}
                      id={k === "확인" ? "auth-ok" : k === "지움" ? "auth-del" : `k${k}`}
                      type="button"
                      onClick={() => (k === "확인" ? pay() : k === "지움" ? setPin((p) => p.slice(0, -1)) : setPin((p) => (p.length < 6 ? p + k : p)))}
                      className={`h-12 rounded-lg text-[18px] font-bold ${
                        k === "확인" ? "bg-[#1b64da] text-white hover:bg-[#1552b8]" : k === "지움" ? "bg-[#eef1f5] text-[#3c4754]" : "border border-[#d5dbe3] bg-white text-[#1b2430] hover:bg-[#f7f9fb]"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {receipt && bill && (
          <section id="receipt" className="mx-auto max-w-xl overflow-hidden rounded-xl border border-[#e3e8ee] bg-white">
            <div className="flex flex-col items-center gap-2 bg-[#f3f7fd] px-6 py-7 text-center">
              <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-[#1b64da] text-white">
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l4.5 4.5L19 7" />
                </svg>
              </span>
              <h2 className="text-[20px] font-extrabold text-[#123a69]">납부가 완료되었습니다</h2>
              <p className="text-[13px] text-[#5b6776]">
                납부확인번호 <strong id="receipt-no" className="tabular-nums text-[#1b2430]">{receipt.receipt}</strong>
              </p>
            </div>
            <table className="w-full text-[14px]">
              <tbody>
                {(
                  [
                    ["기관", bill.issuer],
                    ["납부 항목", bill.title],
                    ["납부의무자", bill.payer],
                    ["납부수단", receipt.method === "card" ? "신용카드" : "계좌이체"],
                    ["납부일시", new Date(receipt.paidAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })],
                  ] as const
                ).map(([k, v]) => (
                  <tr key={k} className="border-b border-[#f0f2f5]">
                    <th className="w-32 bg-[#f7f9fb] px-5 py-3 text-left font-semibold text-[#5b6776]">{k}</th>
                    <td className="px-5 py-3 font-medium">{v}</td>
                  </tr>
                ))}
                <tr>
                  <th className="w-32 bg-[#f7f9fb] px-5 py-3.5 text-left font-semibold text-[#123a69]">납부 금액</th>
                  <td className="px-5 py-3.5 text-[20px] font-extrabold tabular-nums text-[#123a69]">{won(bill.amount)}</td>
                </tr>
              </tbody>
            </table>
            <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row">
              <button type="button" onClick={reset} className="h-11 flex-1 rounded-lg border border-[#c9d1db] bg-white text-[14px] font-bold text-[#3c4754] hover:bg-[#f7f9fb]">
                다른 번호 조회
              </button>
              <button type="button" onClick={() => window.print()} className="h-11 flex-1 rounded-lg bg-[#123a69] text-[14px] font-bold text-white">
                영수증 인쇄
              </button>
            </div>
            <p className="border-t border-[#f0f2f5] px-5 py-3 text-center text-[12px] text-[#9aa5b3]">시연용 포털의 가상 영수증입니다. 실제 납부·출금이 일어나지 않았습니다.</p>
          </section>
        )}
      </main>

      <footer className="border-t border-[#dfe4ea] bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-5 py-5 text-[12px] text-[#7a8796] md:flex-row md:items-center md:justify-between">
          <span>이 포털은 DocDo 해커톤 시연을 위한 가상 환경입니다. 실제 금융 거래가 발생하지 않습니다.</span>
          <span>JunctionX Korea 2026 · Reporch</span>
        </div>
      </footer>
    </div>
  );
}
