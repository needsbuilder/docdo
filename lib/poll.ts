import type { VerifyResult } from "./types";
import type { Phrases } from "./phrase";

// 폴링은 브라우저가 한다. API Route 안에서 기다리면 서버리스 함수가 그대로 붙잡힌다.
// setInterval 을 그냥 두면 실패한 job 에서 영원히 돈다 — 종결 조건과 상한을 명시한다.

export type DocView = {
  id: string;
  pipeline_status: string;
  resolution_status: string;
  action_type: string | null;
  verdict: string | null;
  result: VerifyResult | null;
  phrases: Phrases | null;
  error?: string;
};

export type PollOptions = {
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onTick?: (doc: DocView | null, attempt: number) => void;
};

export class PollTimeout extends Error {
  constructor() {
    super("판독이 예상보다 오래 걸립니다");
    this.name = "PollTimeout";
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    if (signal?.aborted) return rej(signal.reason ?? new Error("aborted"));
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", onAbort);
      res();
    }
    function onAbort() {
      clearTimeout(t);
      rej(signal?.reason ?? new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** 판정이 나올 때까지 조회한다. 관측된 처리시간은 4~26초(n=12)라 상한을 넉넉히 둔다. */
export async function pollDocument(id: string, opts: PollOptions = {}): Promise<DocView> {
  const {
    fetchImpl = fetch,
    intervalMs = 2500,
    timeoutMs = 120_000,
    signal,
    onTick,
  } = opts;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let consecutiveErrors = 0;

  for (;;) {
    attempt++;
    let doc: DocView | null = null;
    try {
      const res = await fetchImpl(`/api/documents/${encodeURIComponent(id)}`, { signal });
      if (res.ok) {
        doc = (await res.json()) as DocView;
        consecutiveErrors = 0;
      } else {
        consecutiveErrors++;
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      consecutiveErrors++;
    }
    onTick?.(doc, attempt);

    // 판정이 실렸으면 끝이다. failed 도 판정이다(verdict='failed').
    if (doc?.result) return doc;
    // 서버가 Upstage 조회에 실패했다. 같은 job 을 다시 물어봐도 달라지지 않는 경우가 있다.
    if (doc?.pipeline_status === "error") return doc;
    // 서버가 계속 안 되면 매달리지 않는다.
    if (consecutiveErrors >= 5) throw new Error("서버에 연결하지 못했습니다");
    if (Date.now() + intervalMs > deadline) throw new PollTimeout();

    await sleep(intervalMs, signal);
  }
}
