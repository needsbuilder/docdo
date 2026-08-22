import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { agentAuthorized } from "@/lib/agentAuth";
import { NO_STORE } from "@/lib/auth";

export const runtime = "nodejs";

/** 워커가 승인된 문서 하나를 집어간다. 보호자 화면 원문(fields) 전체를 준다 — 워커는 서버와 같은 신뢰 영역이다. */
export async function POST(req: Request) {
  if (!agentAuthorized(req)) return NextResponse.json({ error: "없음" }, { status: 404, headers: NO_STORE });
  const doc = await store().claimAction();
  return NextResponse.json({ document: doc }, { headers: NO_STORE });
}
