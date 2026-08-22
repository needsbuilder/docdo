import { NextResponse } from "next/server";
import { findDemoBill, payDemoBill } from "@/lib/demoBills";

export const runtime = "nodejs";

// 시연용 납부 포털 API. 조회(GET) · 납부(POST). 인증은 흉내만 낸다 — 시연 포털임을 화면에 적는다.
export async function GET(req: Request) {
  const epn = new URL(req.url).searchParams.get("epn") ?? "";
  const bill = findDemoBill(epn);
  if (!bill) return NextResponse.json({ error: "전자납부번호를 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json({ bill });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { epn?: string; method?: string } | null;
  const bill = body?.epn ? findDemoBill(body.epn) : null;
  if (!bill) return NextResponse.json({ error: "전자납부번호를 찾을 수 없습니다" }, { status: 404 });
  const rec = payDemoBill(bill.epn);
  return NextResponse.json({ ok: true, receipt: rec.receipt, paidAt: rec.at, amount: bill.amount, method: body?.method ?? "card" });
}
