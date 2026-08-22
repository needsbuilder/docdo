import "server-only";

// Upstage Agent API v2 클라이언트. 서버에서만 부른다.
// server-only 는 Client Component 가 실수로 import 하면 빌드를 깨뜨린다.
// UPSTAGE_API_KEY 에 NEXT_PUBLIC_ 접두사를 붙이면 안 된다 — 소스 전체 공개가 대회 규칙이다.
//
// 엔드포인트는 scripts/run_agent.py 로 실측한 것과 같다.
// 웹훅 콜백이 없어 폴링뿐이지만, 폴링은 브라우저가 한다.
// API Route 안에서 while/sleep 으로 기다리면 서버리스 함수 시간이 그대로 요금과 지연이 된다.

const BASE = "https://api.upstage.ai/v2";
const TIMEOUT_MS = 20_000;
// 촬영 사진은 2~3MB다. 행사장 wifi 에서 업로드가 20초를 넘길 수 있어 따로 둔다.
const UPLOAD_TIMEOUT_MS = 45_000;

export const AGENT_STATUS = ["queued", "in_progress", "completed", "failed"] as const;
export type AgentStatus = (typeof AGENT_STATUS)[number];

export type AgentJob = {
  id?: string;
  // failed 는 종결 상태다. 같은 job_id 재조회로는 안 되고 새 job 을 만들어야 한다.
  status?: AgentStatus | string;
  output?: unknown[];
  error?: unknown;
};

function requireEnv(name: "UPSTAGE_API_KEY" | "UPSTAGE_AGENT_ID"): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 없음 — 서버 환경변수를 확인하세요`);
  return v;
}

async function req(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<unknown> {
  const { timeoutMs = TIMEOUT_MS, headers, ...rest } = init;
  const auth = `Bearer ${requireEnv("UPSTAGE_API_KEY")}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      ...rest,
      signal: ctrl.signal,
      headers: { Authorization: auth, ...(headers ?? {}) },
    });
    if (!res.ok) {
      // 본문은 Upstage 응답이다. 우리 키는 여기 들어가지 않는다.
      const body = await res.text().catch(() => "");
      throw new Error(`Upstage ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function uploadFile(
  buf: Buffer | Uint8Array,
  filename: string,
  mime: string,
): Promise<string> {
  const fd = new FormData();
  fd.append("purpose", "user_data");
  // Content-Type 헤더는 직접 넣지 않는다. boundary 를 fetch 가 붙여야 한다.
  fd.append("file", new File([new Uint8Array(buf)], filename, { type: mime }));
  const j = (await req("/files", {
    method: "POST",
    body: fd,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  })) as { id?: string };
  if (!j?.id) throw new Error("Upstage 업로드 응답에 file id 가 없습니다");
  return j.id;
}

/** job 을 만들고 즉시 반환한다. 완료를 여기서 기다리지 않는다. */
export async function createJob(fileId: string): Promise<AgentJob> {
  const model = requireEnv("UPSTAGE_AGENT_ID");
  requireEnv("UPSTAGE_API_KEY");
  return (await req("/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      // ["last"] 로 부르면 Extract 필드·confidence·location 이 통째로 사라진다.
      include: ["all"],
      input: [{ role: "user", content: [{ type: "input_file", file_id: fileId }] }],
    }),
  })) as AgentJob;
}

/** 요청당 Upstage 1회 조회. 폴링은 호출자(브라우저)가 한다. */
export async function fetchJob(jobId: string): Promise<AgentJob> {
  return (await req(`/responses/${encodeURIComponent(jobId)}?include[]=all`, {
    method: "GET",
  })) as AgentJob;
}

/** 원본 사진은 판독이 끝나면 지운다. 실패해도 흐름을 막지 않되, 실패했다는 사실은 돌려준다. */
export async function deleteFile(fileId: string): Promise<boolean> {
  try {
    await req(`/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    return true;
  } catch (e) {
    console.error("[upstage] 파일 삭제 실패", fileId, e);
    return false;
  }
}
