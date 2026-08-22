"use client";

import { useState } from "react";

// 시연용 납부 포털. 인터넷지로의 화면 흐름(전자납부번호 → 조회 → 납부수단 → 납부)을 흉내 낸다.
// 에이전트 워커가 이 화면을 실제 브라우저로 조작한다. 화면 어디에나 "시연용"이 보이게 둔다.

type Bill = { epn: string; issuer: string; title: string; amount: number; due: string; payer: string };

export default function DemoGiro() {
  const [epn, setEpn] = useState("");
  const [bill, setBill] = useState<Bill | null>(null);
  const [err, setErr] = useState("");
  const [method, setMethod] = useState<"card" | "account">("card");
  const [receipt, setReceipt] = useState<{ receipt: string; paidAt: string } | null>(null);
  // 본인인증 흉내. 실제 인증서 PIN 처럼 6자리를 키패드로 받는다(어떤 숫자든 통과). 에이전트는 이 화면을 넘지 못한다.
  const [authing, setAuthing] = useState(false);
  const [pin, setPin] = useState("");

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBill(null);
    setReceipt(null);
    const r = await fetch(`/api/demo/giro?epn=${encodeURIComponent(epn)}`);
    if (!r.ok) return setErr("전자납부번호를 찾을 수 없습니다");
    setBill(((await r.json()) as { bill: Bill }).bill);
  }
  function startAuth() {
    setAuthing(true);
    setPin("");
  }
  async function pay() {
    if (!bill || pin.length !== 6) return;
    setAuthing(false);
    const r = await fetch("/api/demo/giro", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ epn: bill.epn, method }) });
    if (r.ok) setReceipt((await r.json()) as { receipt: string; paidAt: string });
  }

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-white px-6 py-6 font-sans text-[#222]" style={{ fontFamily: "system-ui, sans-serif" }}>
      <header className="flex items-center justify-between border-b border-[#ddd] pb-4">
        <div className="flex items-center gap-3">
          <span className="rounded bg-[#2e6bd6] px-2 py-1 text-sm font-bold text-white">GIRO</span>
          <span className="text-lg font-bold">통합납부 포털</span>
          <span className="rounded border border-[#d33] px-2 py-0.5 text-xs font-bold text-[#d33]">시연용 · 실제 납부 아님</span>
        </div>
        <nav className="hidden gap-4 text-sm text-[#555] sm:flex">
          <span>지방세입금</span><span>국고금</span><span className="font-bold text-[#2e6bd6]">사회보험료</span><span>전기/수신료</span>
        </nav>
      </header>

      <section className="mt-8 rounded-lg border border-[#ddd] p-6">
        <h1 className="text-xl font-bold">전자납부번호로 조회·납부</h1>
        <form onSubmit={lookup} className="mt-4 flex gap-2">
          <input
            id="epn"
            name="epn"
            value={epn}
            onChange={(e) => setEpn(e.target.value)}
            placeholder="전자납부번호 (‘-’ 포함 가능)"
            className="h-11 flex-1 rounded border border-[#bbb] px-3 text-base"
          />
          <button id="lookup" type="submit" className="h-11 rounded bg-[#2e6bd6] px-5 font-bold text-white">
            조회
          </button>
        </form>
        {err && <p id="error" className="mt-3 text-sm text-[#d33]">{err}</p>}
      </section>

      {bill && !receipt && (
        <section id="bill" className="mt-6 rounded-lg border border-[#ddd] p-6">
          <h2 className="text-lg font-bold">고지 내역</h2>
          <table className="mt-3 w-full text-base">
            <tbody>
              <tr className="border-b border-[#eee]"><th className="w-32 py-2 text-left text-[#666]">기관</th><td id="bill-issuer">{bill.issuer}</td></tr>
              <tr className="border-b border-[#eee]"><th className="py-2 text-left text-[#666]">내역</th><td id="bill-title">{bill.title}</td></tr>
              <tr className="border-b border-[#eee]"><th className="py-2 text-left text-[#666]">납부의무자</th><td id="bill-payer">{bill.payer}</td></tr>
              <tr className="border-b border-[#eee]"><th className="py-2 text-left text-[#666]">납부기한</th><td id="bill-due">{bill.due}</td></tr>
              <tr><th className="py-2 text-left text-[#666]">납부할 금액</th><td id="bill-amount" className="text-xl font-bold">{bill.amount.toLocaleString("ko-KR")}원</td></tr>
            </tbody>
          </table>
          <fieldset className="mt-5">
            <legend className="font-bold">납부수단</legend>
            <div className="mt-2 flex gap-4 text-base">
              <label className="flex items-center gap-2"><input id="method-card" type="radio" name="method" checked={method === "card"} onChange={() => setMethod("card")} /> 신용카드</label>
              <label className="flex items-center gap-2"><input id="method-account" type="radio" name="method" checked={method === "account"} onChange={() => setMethod("account")} /> 계좌이체</label>
            </div>
          </fieldset>
          {!authing ? (
            <button id="pay" type="button" onClick={startAuth} className="mt-5 h-12 w-full rounded bg-[#2e6bd6] text-lg font-bold text-white">
              {bill.amount.toLocaleString("ko-KR")}원 납부하기
            </button>
          ) : (
            <div id="auth" className="mt-5 rounded-lg border-2 border-[#2e6bd6] bg-[#f4f7fc] p-5">
              <h3 className="text-base font-bold">본인인증 · 인증서 비밀번호 6자리</h3>
              <p className="mt-1 text-sm text-[#666]">보안 키패드입니다. 본인이 직접 입력해 주세요. (시연용 — 어떤 숫자든 통과)</p>
              <p id="pin-dots" className="mt-3 text-center text-2xl tracking-[0.5em]">{"●".repeat(pin.length)}{"○".repeat(6 - pin.length)}</p>
              <div className="mx-auto mt-3 grid w-60 grid-cols-3 gap-2">
                {["1","2","3","4","5","6","7","8","9","지움","0","확인"].map((k) => (
                  <button
                    key={k}
                    id={k === "확인" ? "auth-ok" : k === "지움" ? "auth-del" : `k${k}`}
                    type="button"
                    onClick={() => (k === "확인" ? pay() : k === "지움" ? setPin((p) => p.slice(0, -1)) : setPin((p) => (p.length < 6 ? p + k : p)))}
                    className={`h-12 rounded border text-lg font-bold ${k === "확인" ? "border-[#2e6bd6] bg-[#2e6bd6] text-white" : "border-[#bbb] bg-white"}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {receipt && (
        <section id="receipt" className="mt-6 rounded-lg border-2 border-[#2e6bd6] p-6">
          <h2 className="text-lg font-bold text-[#2e6bd6]">납부가 완료되었습니다</h2>
          <p className="mt-2 text-base">납부확인번호 <strong id="receipt-no">{receipt.receipt}</strong></p>
          <p className="text-sm text-[#666]">{new Date(receipt.paidAt).toLocaleString("ko-KR")} · 시연용 포털의 가상 영수증입니다</p>
        </section>
      )}
    </main>
  );
}
