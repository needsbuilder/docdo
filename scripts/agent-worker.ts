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
const HEADED = process.env.AGENT_HEADED === "1";
const POLL_MS = 3000;
if (!SECRET) throw new Error("AGENT_SECRET 없음");

type Doc = {
  id: string;
  verdict: string | null;
  result: { fields?: Record<string, unknown>; fieldConfidence?: Record<string, string>; safeContact?: { phones?: string[] } } | null;
  phrases: { docLabel: string } | null;
};

const api = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-agent-secret": SECRET }, body: JSON.stringify(body) });

async function shot(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: "jpeg", quality: 55, clip: { x: 0, y: 0, width: 900, height: 640 } });
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

async function run(doc: Doc) {
  const step = (title: string, detail?: string, s?: string) => api(`/api/agent/${doc.id}`, { step: { title, detail, shot: s } });
  const finish = (status: "done" | "blocked" | "failed", summary: string, extra: Record<string, string> = {}) =>
    api(`/api/agent/${doc.id}`, { status, result: { summary, ...extra } });

  const f = doc.result?.fields ?? {};
  const conf = doc.result?.fieldConfidence ?? {};
  const epn = conf.epn === "high" && typeof f.epn === "string" ? f.epn : null;
  const amount = conf.amount_krw === "high" && typeof f.amount_krw === "number" ? f.amount_krw : null;
  const label = doc.phrases?.docLabel ?? "우편물";

  if (doc.verdict === "mismatch") return finish("failed", "공식 정보와 다른 문서는 처리하지 않습니다");
  if (!epn) return finish("blocked", "문서에서 전자납부번호를 확실히 읽지 못했습니다", { reason: "epn_low" });
  if (amount === null) return finish("blocked", "문서에서 금액을 확실히 읽지 못했습니다", { reason: "amount_low" });

  await step(`${label} 처리를 시작합니다`, `전자납부번호 ${epn} · 문서 금액 ${amount.toLocaleString("ko-KR")}원`);

  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 350 : 0 });
  const page = await browser.newPage({ viewport: { width: 900, height: 640 }, locale: "ko-KR" });
  try {
    if (ADAPTER === "giro") {
      await page.goto("https://www.giro.or.kr/nomember/agreeNoMemberProvision.do", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);
      await step("인터넷지로 비회원 납부 서비스에 접속했습니다", page.url(), await shot(page));
      await step("금융인증서가 필요한 단계에 도달했습니다", "비회원 서비스도 금융인증서·공동인증서로만 진행됩니다. 인증은 사람이 해야 합니다.", await shot(page));
      return finish("blocked", "인터넷지로는 본인 인증서가 있어야 조회·납부가 됩니다. 인증 단계에서 멈췄습니다.", { reason: "auth_required" });
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
    await page.waitForSelector("#receipt", { timeout: 15000 });
    const receipt = (await page.textContent("#receipt-no"))?.trim() ?? "";
    await step("납부가 완료되었습니다", `납부확인번호 ${receipt}`, await shot(page));
    return finish("done", `${label} ${amount.toLocaleString("ko-KR")}원 납부 완료 · 납부확인번호 ${receipt}`, { receipt });
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    await step("처리 중 오류가 났습니다", msg, await shot(page).catch(() => undefined));
    return finish("failed", "처리 중 오류가 나서 멈췄습니다. 납부는 되지 않았습니다.", { reason: msg.slice(0, 200) });
  } finally {
    if (HEADED) await page.waitForTimeout(2500);
    await browser.close();
  }
}

async function main() {
  console.log(`[agent] ${BASE} · adapter=${ADAPTER} · headed=${HEADED}`);
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
