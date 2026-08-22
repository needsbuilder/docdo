import type { ElderDoc } from "./dto";

// 폴링은 브라우저가 한다. API Route 안에서 기다리면 서버리스 함수가 그대로 붙잡힌다.
// setInterval 을 그냥 두면 실패한 job 에서 영원히 돈다 — 종결 조건과 상한을 명시한다.
// 상한은 **하드** 타임아웃이다. fetch 가 매달려 있어도 deadline 에 끊는다.

export type DocView = ElderDoc;

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

const positive = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;

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
  const fetchImpl = opts.fetchImpl ?? fetch;
  const intervalMs = positive(opts.intervalMs, 2500);
  const timeoutMs = positive(opts.timeoutMs, 120_000);
  const { signal: outer, onTick } = opts;

  // 외부 신호 + 내부 데드라인을 하나로 합친다. 어느 쪽이든 fetch 까지 끊는다.
  const inner = new AbortController();
  const deadlineTimer = setTimeout(() => inner.abort(new PollTimeout()), timeoutMs);
  const onOuterAbort = () => inner.abort(outer?.reason ?? new Error("aborted"));
  if (outer?.aborted) onOuterAbort();
  else outer?.addEventListener("abort", onOuterAbort, { once: true });
  const signal = inner.signal;

  let attempt = 0;
  let consecutiveErrors = 0;

  try {
    for (;;) {
      if (signal.aborted) throw signal.reason;
      attempt++;
      let doc: DocView | null = null;
      let retryable = false;
      try {
        const res = await fetchImpl(`/api/documents/${encodeURIComponent(id)}`, { signal });
        if (res.ok) {
          doc = (await res.json()) as DocView;
          consecutiveErrors = 0;
        } else if (res.status === 503) {
          // 서버가 Upstage 조회에 실패했다. 일시적일 수 있으니 다시 물어본다.
          retryable = true;
          consecutiveErrors++;
        } else {
          consecutiveErrors++;
        }
      } catch (e) {
        if (signal.aborted) throw signal.reason ?? e;
        consecutiveErrors++;
      }
      onTick?.(doc, attempt);

      // 판정과 문구가 둘 다 실렸을 때만 끝이다. failed 도 판정이다(verdict='failed').
      if (doc?.result && doc.phrases) return doc;
      // 서버가 실패로 굳힌 행. 더 물어볼 게 없다.
      if (doc?.pipeline_status === "failed" && doc.error) return doc;
      // 서버가 계속 안 되면 매달리지 않는다.
      if (!retryable && consecutiveErrors >= 5) throw new Error("서버에 연결하지 못했습니다");
      if (consecutiveErrors >= 12) throw new Error("서버에 연결하지 못했습니다");

      await sleep(intervalMs, signal);
    }
  } finally {
    clearTimeout(deadlineTimer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}
