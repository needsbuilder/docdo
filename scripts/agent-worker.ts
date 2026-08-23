// 에이전트 워커. 보호자가 승인한 문서를 집어 실제 브라우저로 납부 포털을 조작한다.
//
//   npx tsx scripts/agent-worker.ts            (.env 의 AGENT_SECRET · 기본 서버 http://localhost:3000)
//   DOCDO_URL=https://docdo.vercel.app npx tsx scripts/agent-worker.ts
//   AGENT_HEADED=1 로 브라우저를 화면에 띄운다 — 시연은 이 모드.
//
// 어댑터
//   demo : 이 앱 안의 시연용 포털(/demo/giro). 합성 고지서의 전자납부번호를 안다.
//   giro : 인터넷지로(giro.or.kr). 비회원 서비스도 금융인증서가 필요해 인증 벽에서 멈추고
//          화면을 남긴다(blocked). 인증서 자동화는 하지 않는다.
//
// 안전: 워커는 mismatch 문서를 절대 받지 않는다(서버가 승인 단계에서 막는다). 금액·번호는
// Extract high 필드만 쓰고, 포털이 보여준 금액이 문서 금액과 다르면 납부하지 않는다.

import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { snapshot, decide, systemPrompt, type Snapshot } from "./agent-brain";

function loadEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* .env 없음 */
  }
}
loadEnv();

const BASE = process.env.DOCDO_URL ?? "http://localhost:3000";
const SECRET = process.env.AGENT_SECRET ?? "";
const ADAPTER = process.env.AGENT_ADAPTER ?? "demo";
// llm: Solar Pro 4 가 화면 구조를 읽고 행동을 고른다(기본). script: 기관별 고정 절차(폴백).
const MODE = process.env.AGENT_MODE ?? "llm";
const UPSTAGE_KEY = process.env.UPSTAGE_API_KEY ?? "";
const MAX_STEPS = 25;
const SITES: Record<string, { url: string; hosts: string[] }> = {
  demo: { url: `${process.env.DOCDO_URL ?? "http://localhost:3000"}/demo/giro`, hosts: [new URL(process.env.DOCDO_URL ?? "http://localhost:3000").host] },
  giro: { url: "https://www.giro.or.kr/nomember/agreeNoMemberProvision.do", hosts: ["www.giro.or.kr", "giro.or.kr"] },
};
// 되돌릴 수 없는 버튼. 누르기 전에 화면에 문서 금액이 보여야 한다.
const IRREVERSIBLE = /납부|결제|이체|송금|승인/;
// 절대 누르지 않는 것. 페이지 본문이 모델 입력에 들어가므로(인젝션) 모델이 골라도 코드가 거부한다.
const FORBIDDEN = /자동이체|회원가입|탈퇴|해지|대출|카드\s*발급|예약납부|분할|환급\s*신청|송금\s*등록/;
// 사람 차례 신호. 보이면 모델이 뭐라 하든 멈춘다.
const HUMAN = /비밀번호|인증서|본인인증|보안\s*키패드|OTP|공동인증|금융인증|간편인증/;
const HEADED = process.env.AGENT_HEADED === "1";
const POLL_MS = 3000;
const LIVE_MS = 700;
if (!SECRET) throw new Error("AGENT_SECRET 없음");

type AgentInput =
  | { id: string; kind: "tap"; x: number; y: number }
  | { id: string; kind: "type"; text: string }
  | { id: string; kind: "key"; key: string }
  | { id: string; kind: "resume" };

type Doc = {
  id: string;
  action_run: string | null;
  action_trace?: Array<{ title: string; detail?: string }>;
  verdict: string | null;
  result: { fields?: Record<string, unknown>; fieldConfidence?: Record<string, string>; safeContact?: { phones?: string[] } } | null;
  phrases: { docLabel: string } | null;
};

/** 실행이 무효화됐다(재승인·다른 워커). 즉시 멈춘다 — 브라우저 조작을 더 하면 안 된다. */
class LeaseLost extends Error {}

const api = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-secret": SECRET }, body: JSON.stringify(body) });

/** 문서 전용 호출. run 리스를 싣고, 409 면 LeaseLost. */
async function docApi(doc: Doc, body: Record<string, unknown>) {
  const r = await api(`/api/agent/${doc.id}`, { run: doc.action_run, ...body });
  if (r.status === 409) throw new LeaseLost("lease lost");
  return r;
}

async function shot(page: Page, quality = 55): Promise<string> {
  const buf = await page.screenshot({ type: "jpeg", quality, clip: { x: 0, y: 0, width: 900, height: 640 } });
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/** 실행 중 화면을 보호자 폰으로 계속 보낸다. 단계 기록과 별개로, 실패해도 흐름을 막지 않는다. */
let pushLiveNow: (() => Promise<void>) | null = null;
function startLive(page: Page, doc: Doc): () => void {
  let stopped = false;
  let busy = false;
  const tick = async () => {
    if (stopped || busy || page.isClosed()) return;
    busy = true;
    try {
      const live = await shot(page, 40);
      await docApi(doc, { live });
    } catch {
      /* 다음 프레임에 다시 */
    } finally {
      busy = false;
    }
  };
  const t = setInterval(tick, LIVE_MS);
  pushLiveNow = tick;
  return () => {
    stopped = true;
    pushLiveNow = null;
    clearInterval(t);
  };
}

/** 사람 차례. 보호자 폰에서 오는 터치·키 입력을 브라우저에 그대로 넣고, [이어서 하기]가 오면 돌아온다. */
async function waitForHuman(page: Page, doc: Doc, reason: string, hint: string, mode: "remote" | "confirm" = "remote"): Promise<void> {
  // 사람이 조작할 부분(인증·비밀번호)이 실시간 화면 안에 들어오게 스크롤한다. 터치 좌표는 화면 기준이다.
  await page
    .evaluate(
      `(() => { const re = /비밀번호|인증서|본인인증|키패드|OTP|인증/; const els = Array.from(document.querySelectorAll("h1,h2,h3,h4,legend,label,p,div")); const el = els.find((e) => e.children.length < 12 && re.test(e.textContent || "")); if (el) el.scrollIntoView({ block: "start" }); })()`,
    )
    .catch(() => {});
  await page.waitForTimeout(300);
  await docApi(doc, { wait: { reason, hint, mode }, step: { title: "보호자 차례 — " + reason, detail: hint, shot: await shot(page).catch(() => undefined) } });
  // 대기 전에 쌓인 입력은 다른 화면을 향한 것이다. 실행하지 않고 버린다.
  {
    const r0 = await docApi(doc, { consumed: [] });
    const { inputs: stale = [] } = (await r0.json().catch(() => ({}))) as { inputs?: AgentInput[] };
    if (stale.length) await docApi(doc, { consumed: stale.map((i) => i.id) });
  }
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const r = await docApi(doc, { consumed: [] });
    const { inputs = [] } = (await r.json().catch(() => ({}))) as { inputs?: AgentInput[] };
    const consumed: string[] = [];
    let resume = false;
    for (const i of inputs) {
      consumed.push(i.id);
      try {
        if (i.kind === "tap") await page.mouse.click(i.x, i.y);
        else if (i.kind === "type") await page.keyboard.type(i.text, { delay: 40 });
        else if (i.kind === "key") await page.keyboard.press(i.key);
        else if (i.kind === "resume") resume = true;
      } catch (e) {
        console.error("[agent] 입력 실패", e instanceof Error ? e.message : e);
      }
    }
    if (consumed.length) {
      await docApi(doc, { consumed });
      // 입력을 반영한 화면을 바로 올린다 — 주기를 기다리면 보호자가 느리다고 느낀다.
      await page.waitForTimeout(120);
      await pushLiveNow?.();
    }
    if (resume) {
      await docApi(doc, { status: "running", step: { title: "보호자가 넘겨줘서 이어서 진행합니다" } });
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("보호자 응답 없이 20분이 지났습니다");
}

const won = (n: number) => n.toLocaleString("ko-KR");
const AMOUNT_LABEL = /(납부\s*할\s*금액|납부\s*금액|결제\s*금액|총\s*납부|납부\s*총액|청구\s*금액|납기\s*내\s*금액)/g;
/** "납부할 금액" 같은 라벨 뒤의 금액만 본다. 페이지 어딘가에 같은 숫자가 있는 것으로는 부족하다.
 *  라벨이 여러 개면 전부 문서 금액과 같아야 한다(납기후·포인트 같은 다른 숫자가 끼면 거부). 라벨이 없으면 버튼 글자로만 판단. */
function amountConfirmed(text: string, amount: number, buttonName: string): boolean {
  const exact = new RegExp(`^${won(amount).replace(/,/g, "[,\\s]?")}$`);
  const found: string[] = [];
  for (const m of text.matchAll(new RegExp(AMOUNT_LABEL.source + "[^\\d]{0,12}([\\d][\\d,\\s]{0,14}\\d|\\d)\\s*원", "g"))) found.push(m[2].replace(/\s/g, ""));
  if (found.length) return found.every((v) => exact.test(v));
  const inButton = buttonName.match(/([\d][\d,]{0,14}\d|\d)\s*원/);
  return !!inButton && exact.test(inButton[1]);
}

/** Solar 가 화면을 읽고 행동을 고르는 루프. 가드레일은 여기(코드)에 있다. */
async function runLLM(page: Page, doc: Doc, label: string, epn: string, amount: number, issuer: string | null,
  step: (title: string, detail?: string, s?: string) => Promise<unknown>,
  finish: (status: "done" | "blocked" | "failed", summary: string, extra?: Record<string, string>) => Promise<unknown>) {
  // 보호자가 승인할 때 고른 사이트가 우선. 없으면 환경변수.
  const chosen = doc.action_trace?.[0]?.detail?.match(/site=(\w+)/)?.[1];
  const site = SITES[chosen ?? ADAPTER] ?? SITES.demo;
  await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(800);
  // 실제 기관 사이트는 데스크톱 폭(1200px+)이라 900px 화면에 안 들어온다. 축소해서 폰 실시간 화면에 전부 보이게.
  if (site !== SITES.demo) {
    const fit = "(()=>{document.documentElement.style.zoom='0.7';})()";
    await page.evaluate(fit).catch(() => {});
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) page.evaluate(fit).catch(() => {}); });
  }
  await step("사이트에 접속했습니다", site.url, await shot(page));

  let messages: Parameters<typeof decide>[1] = [{ role: "system", content: systemPrompt({ label, issuer, epn, amount, site: site.url }) }];
  let paid = false;
  let lastSig = "";
  let sameCount = 0;
  // 보호자가 [이어서 하기]를 누른 직후 한 번은 인증 문구가 남아 있어도 모델이 움직이게 둔다(약관 동의 → 다음 화면).
  let skipHumanOnce = false;

  for (let i = 1; i <= MAX_STEPS; i++) {
    if (!site.hosts.includes(new URL(page.url()).host)) {
      await step("허용된 사이트 밖으로 나가서 멈춥니다", page.url(), await shot(page));
      return finish("blocked", "허용된 사이트 밖으로 이동해 멈췄습니다", { reason: "offsite" });
    }
    const snap: Snapshot = await snapshot(page);
    const sig = snap.url + "|" + snap.refs.map((r) => r.role + r.name).join(",") + "|" + snap.text.slice(0, 300);
    sameCount = sig === lastSig ? sameCount + 1 : 0;
    lastSig = sig;
    if (sameCount >= 3) return finish("failed", "화면이 바뀌지 않아 멈췄습니다", { reason: "stuck" });

    // 가드 1: 사람 차례 신호가 보이면 모델을 부르지 않고 바로 넘긴다.
    if (HUMAN.test(snap.text) && !skipHumanOnce) {
      await page.evaluate("window.scrollBy(0, 240)");
      await waitForHuman(page, doc, "본인 확인이 필요한 단계입니다", "비밀번호·인증은 독도가 입력하지 않습니다. 화면을 눌러 직접 마친 뒤 [이어서 하기]를 눌러 주세요.");
      skipHumanOnce = true;
      continue;
    }
    skipHumanOnce = false;

    const { action, messages: next } = await decide(UPSTAGE_KEY, messages, snap, i);
    messages = next;
    const ref = "ref" in action ? snap.refs.find((r) => r.ref === action.ref) : undefined;
    const why = "why" in action ? action.why : "";

    if (action.kind === "abort") return finish("blocked", `에이전트가 멈췄습니다: ${action.reason}`, { reason: "abort" });
    if (action.kind === "wait_human") {
      await waitForHuman(page, doc, action.reason, action.hint);
      skipHumanOnce = true;
      continue;
    }
    if (action.kind === "done") {
      if (!paid) return finish("blocked", "납부 단계 없이 끝내려 해서 멈췄습니다", { reason: "done_without_pay" });
      await step("납부 완료를 확인했습니다", action.summary, await shot(page));
      const rec = snap.text.match(/납부확인번호\s*([A-Z0-9-]+)/)?.[1] ?? "";
      return finish("done", `${label} ${won(amount)}원 납부 완료${rec ? ` · 납부확인번호 ${rec}` : ""}`, rec ? { receipt: rec } : {});
    }
    if ((action.kind === "click" || action.kind === "type") && !ref) {
      await step("모델이 없는 요소를 골라 건너뜁니다", `ref ${action.ref}`);
      continue;
    }
    if (action.kind === "type" && ref) {
      if (ref.type === "password") {
        await waitForHuman(page, doc, "비밀번호 입력 단계입니다", "비밀번호는 독도가 입력하지 않습니다. 직접 입력한 뒤 [이어서 하기]를 눌러 주세요.");
        continue;
      }
      await page.fill(ref.selector, action.text);
      await step(`입력: ${ref.name || ref.role}`, `${action.text} — ${why}`);
    } else if (action.kind === "click" && ref) {
      // 가드 0: 목표와 무관한 계약·신청 버튼은 모델이 골라도 거부한다.
      if (FORBIDDEN.test(ref.name)) {
        await step("목표와 무관한 버튼을 누르려 해서 멈춥니다", ref.name, await shot(page));
        return finish("blocked", `"${ref.name}" 은 납부와 무관한 행동이라 멈췄습니다`, { reason: "forbidden_click" });
      }
      // 가드 2: 되돌릴 수 없는 버튼은 화면에 문서 금액이 보일 때만.
      if (IRREVERSIBLE.test(ref.name) && !amountConfirmed(snap.text, amount, ref.name)) {
        await step("금액 확인 없이 납부 버튼을 누르려 해서 멈춥니다", ref.name, await shot(page));
        return finish("blocked", "화면에서 문서 금액을 확인하지 못해 납부를 멈췄습니다", { reason: "amount_not_visible" });
      }
      const irreversible = IRREVERSIBLE.test(ref.name);
      if (irreversible) await step("납부 금액이 문서와 일치합니다 — 납부를 진행합니다", `${won(amount)}원 · ${ref.name}`, await shot(page));
      await page.click(ref.selector).catch(async () => page.locator(ref.selector).click({ force: true }));
      if (irreversible) paid = true;
      await step(`클릭: ${ref.name || ref.role}`, why, await shot(page));
    } else if (action.kind === "press") {
      await page.keyboard.press(action.key);
      await step(`키: ${action.key}`, why);
    } else if (action.kind === "scroll") {
      await page.evaluate(`window.scrollBy(0, ${action.dir === "up" ? -480 : 480})`);
      await step(`스크롤 ${action.dir === "up" ? "위" : "아래"}`, why);
    }
    await page.waitForTimeout(700);
  }
  return finish("failed", `${MAX_STEPS}단계 안에 끝내지 못했습니다`, { reason: "max_steps" });
}

async function run(doc: Doc) {
  const step = (title: string, detail?: string, s?: string) => docApi(doc, { step: { title, detail, shot: s } });
  const finish = (status: "done" | "blocked" | "failed", summary: string, extra: Record<string, string> = {}) =>
    docApi(doc, { status, result: { summary, ...extra } });

  const f = doc.result?.fields ?? {};
  const conf = doc.result?.fieldConfidence ?? {};
  const epn = conf.epn === "high" && typeof f.epn === "string" ? f.epn : null;
  const amount = conf.amount_krw === "high" && typeof f.amount_krw === "number" ? f.amount_krw : null;
  const label = doc.phrases?.docLabel ?? "우편물";

  if (doc.verdict === "mismatch") return finish("failed", "공식 정보와 다른 문서는 처리하지 않습니다");
  if (!epn) return finish("blocked", "문서에서 전자납부번호를 확실히 읽지 못했습니다", { reason: "epn_low" });
  if (amount === null) return finish("blocked", "문서에서 금액을 확실히 읽지 못했습니다", { reason: "amount_low" });

  await step(`${label} 처리를 시작합니다`, `전자납부번호 ${epn} · 문서 금액 ${amount.toLocaleString("ko-KR")}원`);

  const browser = await chromium.launch({ headless: !HEADED, slowMo: Number(process.env.AGENT_SLOWMO ?? (HEADED ? 350 : 0)) });
  const page = await browser.newPage({ viewport: { width: 900, height: 640 }, locale: "ko-KR" });
  const stopLive = startLive(page, doc);
  try {
    if (MODE === "llm") {
      if (!UPSTAGE_KEY) return finish("failed", "UPSTAGE_API_KEY 없음");
      // 문서에서 읽은 글자는 프롬프트에 들어간다. 줄바꿈·길이를 자른다(문서발 인젝션 완화).
      const clean = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\r\n\t"`]/g, " ").slice(0, n) : null);
      const issuer = clean(f.issuer, 40);
      return await runLLM(page, doc, clean(label, 20) ?? "우편물", clean(epn, 30) ?? epn, amount, issuer, step, finish);
    }
    if (ADAPTER === "giro") {
      await page.goto("https://www.giro.or.kr/nomember/agreeNoMemberProvision.do", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);
      await step("인터넷지로 비회원 납부 서비스에 접속했습니다", page.url(), await shot(page));
      await waitForHuman(page, doc, "인증서 확인이 필요합니다", "인터넷지로는 금융인증서·공동인증서로만 진행됩니다. 화면을 눌러 직접 인증을 마친 뒤 [이어서 하기]를 눌러 주세요.");
      await step("인증 이후 화면입니다", page.url(), await shot(page));
      return finish("blocked", "인터넷지로 어댑터는 인증 이후 단계(조회·납부)가 아직 구현되지 않았습니다.", { reason: "giro_wip" });
    }

    // demo 어댑터
    await page.goto(`${BASE}/demo/giro`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await step("납부 포털에 접속했습니다", `${BASE}/demo/giro`, await shot(page));
    await page.fill("#epn", epn);
    await page.click("#lookup");
    await page.waitForSelector("#bill, #error", { timeout: 15000 });
    if (await page.$("#error")) {
      await step("전자납부번호를 포털이 찾지 못했습니다", epn, await shot(page));
      return finish("blocked", "포털에서 이 전자납부번호의 고지 내역을 찾지 못했습니다", { reason: "not_found" });
    }
    const portalAmount = Number((await page.textContent("#bill-amount"))?.replace(/\D/g, "") ?? "");
    const portalIssuer = (await page.textContent("#bill-issuer"))?.trim() ?? "";
    await step("고지 내역을 조회했습니다", `${portalIssuer} · ${portalAmount.toLocaleString("ko-KR")}원`, await shot(page));

    if (portalAmount !== amount) {
      await step("금액이 문서와 다릅니다 — 납부하지 않습니다", `문서 ${amount.toLocaleString("ko-KR")}원 / 포털 ${portalAmount.toLocaleString("ko-KR")}원`);
      return finish("blocked", `포털 금액(${portalAmount.toLocaleString("ko-KR")}원)이 문서 금액과 달라 납부를 멈췄습니다`, { reason: "amount_mismatch" });
    }
    await step("문서 금액과 포털 금액이 일치합니다", `${amount.toLocaleString("ko-KR")}원`);
    await page.check("#method-card");
    await step("납부수단을 선택했습니다", "신용카드", await shot(page));
    await page.click("#pay");
    await page.waitForSelector("#auth", { timeout: 15000 });
    await page.locator("#auth").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await step("본인인증 화면입니다 — 비밀번호는 에이전트가 입력하지 않습니다", "보안 키패드 6자리", await shot(page));
    await waitForHuman(page, doc, "인증서 비밀번호를 직접 눌러 주세요", "아래 화면의 키패드를 눌러 6자리를 입력하고 [확인]까지 누른 뒤 [이어서 하기]를 눌러 주세요.");
    await page.waitForSelector("#receipt", { timeout: 15000 });
    const receipt = (await page.textContent("#receipt-no"))?.trim() ?? "";
    await step("납부가 완료되었습니다", `납부확인번호 ${receipt}`, await shot(page));
    return finish("done", `${label} ${amount.toLocaleString("ko-KR")}원 납부 완료 · 납부확인번호 ${receipt}`, { receipt });
  } catch (e) {
    if (e instanceof LeaseLost) {
      console.error("[agent] 실행 리스 상실 — 다른 워커가 이어받았거나 재승인됨. 이 브라우저는 여기서 멈춘다.");
      return;
    }
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    await step("처리 중 오류가 났습니다", msg, await shot(page).catch(() => undefined));
    return finish("failed", "처리 중 오류가 나서 멈췄습니다. 납부는 되지 않았습니다.", { reason: msg.slice(0, 200) });
  } finally {
    if (HEADED) await page.waitForTimeout(2500);
    stopLive();
    await browser.close();
  }
}

async function main() {
  console.log(`[agent] ${BASE} · mode=${MODE} · adapter=${ADAPTER} · headed=${HEADED}`);
  for (;;) {
    try {
      const r = await api("/api/agent/claim", {});
      if (r.ok) {
        const { document } = (await r.json()) as { document: Doc | null };
        if (document) {
          console.log(`[agent] 집음 ${document.id}`);
          await run(document);
          console.log(`[agent] 끝 ${document.id}`);
          continue;
        }
      } else {
        console.error(`[agent] claim ${r.status}`);
      }
    } catch (e) {
      console.error("[agent]", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
void main();
