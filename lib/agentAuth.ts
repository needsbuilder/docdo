import "server-only";
import { timingSafeEqual } from "node:crypto";

// 워커(노트북·VM)가 서버에 자신을 증명하는 비밀. 보호자 세션과 무관하다.
export function agentAuthorized(req: Request): boolean {
  const want = process.env.AGENT_SECRET;
  const got = req.headers.get("x-agent-secret");
  if (!want || !got || want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}
