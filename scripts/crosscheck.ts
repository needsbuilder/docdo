// TS 포팅본이 Python 원본과 같은 판정을 내는지 대조한다.
// 사용: npx tsx scripts/crosscheck.ts docs/evidence/photo
import fs from "node:fs";
import path from "node:path";
import { verify } from "../lib/verify";

const dir = process.argv[2] ?? "docs/evidence/photo";
for (const f of fs.readdirSync(dir).sort()) {
  if (!f.endsWith(".json")) continue;
  const r = verify(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  const name = f.replace("agent-raw-", "").replace(".json", "");
  console.log(`${name}\t${r.verdict}\t${r.checksPassed ?? "-"}/${r.checksTotal ?? "-"}`);
}
