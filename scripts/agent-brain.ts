// 화면 구조를 읽고 다음 행동을 고르는 두뇌. Upstage Solar Pro 4 (함수 호출).
// 픽셀이 아니라 접근성 트리(버튼·입력·링크의 역할과 글자)를 본다 — 레이아웃이 바뀌어도 "조회 버튼"을 의미로 찾는다.
// 돈이 걸린 판단은 모델에게 맡기지 않는다: 가드레일은 agent-worker.ts 에서 코드로 건다.

import type { Page } from "playwright";

export type Ref = { ref: number; role: string; name: string; value?: string; tag: string; type?: string; selector: string };
export type Snapshot = { url: string; title: string; refs: Ref[]; text: string };

export type Action =
  | { kind: "click"; ref: number; why: string }
  | { kind: "type"; ref: number; text: string; why: string }
  | { kind: "press"; key: string; why: string }
  | { kind: "scroll"; dir: "down" | "up"; why: string }
  | { kind: "wait_human"; reason: string; hint: string }
  | { kind: "done"; summary: string }
  | { kind: "abort"; reason: string };

const MAX_REFS = 80;
const MAX_TEXT = 2500;

const SNAPSHOT_JS = `(() => {
  const max = __MAX__;
  const sel = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick]';
  const out = [];
  let n = 0;
  const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
  const label = (e) => {
    const aria = e.getAttribute("aria-label");
    const lab = e.id ? (document.querySelector('label[for="' + CSS.escape(e.id) + '"]') || {}).textContent : null;
    return (aria || lab || e.innerText || e.placeholder || e.value || e.getAttribute("title") || "").trim().replace(/\\s+/g, " ").slice(0, 60);
  };
  document.querySelectorAll("[data-docdo-ref]").forEach((e) => e.removeAttribute("data-docdo-ref"));
  for (const el of Array.from(document.querySelectorAll(sel))) {
    if (!vis(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = el.type || undefined;
    if (tag === "input" && type === "hidden") continue;
    n++;
    el.setAttribute("data-docdo-ref", String(n));
    const role = el.getAttribute("role") || (tag === "a" ? "link" : tag === "button" ? "button" : tag === "input" ? (type === "radio" ? "radio" : type === "checkbox" ? "checkbox" : "textbox") : tag);
    out.push({ ref: n, role, name: label(el), tag, type, value: tag === "input" && type !== "password" ? String(el.value || "").slice(0, 40) : undefined });
    if (n >= max) break;
  }
  return out;
})()`;

/** 상호작용 가능한 요소에 번호를 붙여 모델에게 보여줄 스냅샷을 만든다. data-docdo-ref 로 다시 찾는다. */
export async function snapshot(page: Page): Promise<Snapshot> {
  // tsx/esbuild 가 함수에 __name 헬퍼를 끼워 넣어 브라우저에서 깨진다 — 문자열로 넘긴다.
  const refs = (await page.evaluate(SNAPSHOT_JS.replace("__MAX__", String(MAX_REFS)))) as Array<Omit<Ref, "selector">>;
  const text = ((await page.innerText("body").catch(() => "")) || "").replace(/\s+/g, " ").slice(0, MAX_TEXT);
  return { url: page.url(), title: await page.title(), refs: refs.map((r) => ({ ...r, selector: `[data-docdo-ref="${r.ref}"]` })), text };
}

export function renderSnapshot(s: Snapshot): string {
  const lines = s.refs.map((r) => {
    const v = r.value !== undefined ? ` value="${r.value}"` : "";
    const t = r.type && r.type !== "text" ? ` type=${r.type}` : "";
    return `[${r.ref}] ${r.role}${t} "${r.name}"${v}`;
  });
  return `URL: ${s.url}\n제목: ${s.title}\n요소:\n${lines.join("\n")}\n본문 발췌: ${s.text}`;
}

const TOOLS = [
  { type: "function", function: { name: "click", description: "요소를 클릭한다", parameters: { type: "object", properties: { ref: { type: "integer" }, why: { type: "string" } }, required: ["ref", "why"] } } },
  { type: "function", function: { name: "type", description: "입력란에 글자를 넣는다(기존 값은 지운다)", parameters: { type: "object", properties: { ref: { type: "integer" }, text: { type: "string" }, why: { type: "string" } }, required: ["ref", "text", "why"] } } },
  { type: "function", function: { name: "press", description: "키를 누른다 (Enter, Tab, Escape)", parameters: { type: "object", properties: { key: { type: "string" }, why: { type: "string" } }, required: ["key", "why"] } } },
  { type: "function", function: { name: "scroll", description: "화면을 내리거나 올린다", parameters: { type: "object", properties: { dir: { type: "string", enum: ["down", "up"] }, why: { type: "string" } }, required: ["dir", "why"] } } },
  { type: "function", function: { name: "wait_human", description: "사람이 직접 해야 하는 단계(본인인증·인증서·비밀번호·보안 키패드·약관 동의 같은 법적 행위). 보호자에게 넘긴다.", parameters: { type: "object", properties: { reason: { type: "string" }, hint: { type: "string", description: "보호자가 화면에서 무엇을 하면 되는지 한두 문장" } }, required: ["reason", "hint"] } } },
  { type: "function", function: { name: "done", description: "목표를 달성했다(납부 완료 화면·영수번호를 확인한 뒤에만)", parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } } },
  { type: "function", function: { name: "abort", description: "진행하면 안 되는 상황(금액·기관·번호가 문서와 다름, 목표와 무관한 사이트, 막다른 길)", parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } } },
];

export type Goal = { label: string; issuer: string | null; epn: string; amount: number; site: string };

export function systemPrompt(g: Goal): string {
  return [
    "너는 고령자 보호자를 대신해 공과금 납부 사이트를 조작하는 에이전트다. 화면의 요소 목록과 본문을 읽고, 목표를 향해 한 번에 행동 하나만 도구로 호출한다.",
    `목표: ${g.site} 에서 전자납부번호 ${g.epn} 로 "${g.label}"(${g.issuer ?? "기관 미상"}) 고지 내역을 조회하고, 화면의 납부 금액이 문서 금액 ${g.amount.toLocaleString("ko-KR")}원과 정확히 같을 때만 신용카드로 납부한 뒤 납부 완료(영수번호)를 확인하고 done 을 호출한다.`,
    "규칙:",
    "1) 비밀번호·인증서·본인인증·보안 키패드·OTP 는 절대 네가 입력하지 않는다. 그 화면이 보이면 즉시 wait_human 을 호출한다.",
    "2) 화면 금액이 문서 금액과 다르거나, 기관명이 다르거나, 전자납부번호를 찾을 수 없으면 abort 한다. 추측으로 진행하지 않는다.",
    "3) 납부·결제·이체 버튼은 금액을 확인한 뒤에만 누른다. 자동이체 신청·회원가입·광고·다른 상품 링크는 누르지 않는다.",
    "4) 같은 행동을 두 번 반복하지 않는다. 화면이 바뀌지 않으면 다른 방법을 찾거나 abort 한다.",
    "5) why 에는 한국어로 한 문장.",
  ].join("\n");
}

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: unknown[]; tool_call_id?: string };

export async function decide(apiKey: string, history: Msg[], snap: Snapshot, stepNo: number): Promise<{ action: Action; raw: string; messages: Msg[] }> {
  const user: Msg = { role: "user", content: `[${stepNo}단계] 현재 화면:\n${renderSnapshot(snap)}\n\n다음 행동 하나를 도구로 호출하라.` };
  const messages = [...history, user];
  const res = await fetch("https://api.upstage.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "solar-pro4", messages, tools: TOOLS, tool_choice: "required", max_tokens: 400, temperature: 0 }),
  });
  if (!res.ok) throw new Error(`solar ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = (await res.json()) as { choices: Array<{ message: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
  const m = d.choices[0].message;
  const tc = m.tool_calls?.[0];
  if (!tc) return { action: { kind: "abort", reason: "모델이 행동을 고르지 못했습니다" }, raw: m.content ?? "", messages };
  let a: Record<string, unknown> = {};
  try {
    a = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
  } catch {
    /* 빈 인자 */
  }
  const n = tc.function.name;
  const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  const num = (k: string) => (typeof a[k] === "number" ? (a[k] as number) : Number(a[k]));
  const action: Action =
    n === "click" ? { kind: "click", ref: num("ref"), why: str("why") }
    : n === "type" ? { kind: "type", ref: num("ref"), text: str("text"), why: str("why") }
    : n === "press" ? { kind: "press", key: str("key") || "Enter", why: str("why") }
    : n === "scroll" ? { kind: "scroll", dir: str("dir") === "up" ? "up" : "down", why: str("why") }
    : n === "wait_human" ? { kind: "wait_human", reason: str("reason") || "사람이 해야 하는 단계", hint: str("hint") || "화면에서 직접 진행한 뒤 [이어서 하기]를 눌러 주세요." }
    : n === "done" ? { kind: "done", summary: str("summary") }
    : { kind: "abort", reason: str("reason") || "중단" };
  // 대화 이력에는 모델의 첫 도구 호출 하나만 남긴다(한 번에 하나 규칙).
  const assistant: Msg = { role: "assistant", content: m.content ?? "", tool_calls: [{ id: tc.id, type: "function", function: tc.function }] };
  const toolMsg: Msg = { role: "tool", tool_call_id: tc.id, content: "실행함" };
  return { action, raw: JSON.stringify(a), messages: [...messages, assistant, toolMsg] };
}
