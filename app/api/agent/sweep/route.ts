import { NextResponse } from "next/server";
import { agentAuthorized } from "@/lib/agentAuth";
import { NO_STORE } from "@/lib/auth";
import { sweepPending } from "@/lib/advance";

export const runtime = "nodejs";

/** 워커가 몇 초마다 부른다 — 판정이 안 난 최근 문서를 Upstage 결과로 진행시킨다.
 *  어르신 폰이 잠기거나 탭이 멈춰도 결과는 나와야 한다. */
export async function POST(req: Request) {
  if (!agentAuthorized(req)) return NextResponse.json({ error: "없음" }, { status: 404, headers: NO_STORE });
  const r = await sweepPending({ limit: 3 });
  return NextResponse.json(r, { headers: NO_STORE });
}
