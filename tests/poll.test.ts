import { describe, it, expect, vi } from "vitest";
import { pollDocument, PollTimeout, type DocView } from "@/lib/poll";

// setInterval 을 그냥 두면 실패한 job 에서 영원히 돈다. 종결 조건을 고정한다.

const base: DocView = {
  id: "d1",
  pipeline_status: "queued",
  resolution_status: "new",
  action_type: null,
  verdict: null,
  result: null,
  phrases: null,
};

function res(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

const done = {
  ...base,
  pipeline_status: "completed",
  verdict: "clear",
  result: { verdict: "clear", checks: [], reasons: [] },
  phrases: { docLabel: "건강보험료", screenLines: ["3만 2천원"], speech: "..." },
} as unknown as DocView;

describe("pollDocument", () => {
  it("판정이 실릴 때까지 조회하고 멈춘다", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res({ ...base, pipeline_status: "queued" }))
      .mockResolvedValueOnce(res({ ...base, pipeline_status: "in_progress" }))
      .mockResolvedValueOnce(res(done));
    const r = await pollDocument("d1", { fetchImpl, intervalMs: 1 });
    expect(r.verdict).toBe("clear");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("failed 판정도 종결이다", async () => {
    const failed = { ...done, verdict: "failed", pipeline_status: "failed" };
    const fetchImpl = vi.fn().mockResolvedValue(res(failed));
    expect((await pollDocument("d1", { fetchImpl, intervalMs: 1 })).verdict).toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("서버가 error 를 주면 매달리지 않는다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ ...base, pipeline_status: "error" }));
    const r = await pollDocument("d1", { fetchImpl, intervalMs: 1 });
    expect(r.pipeline_status).toBe("error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("계속 실패하면 5회에서 포기한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({}, false, 500));
    await expect(pollDocument("d1", { fetchImpl, intervalMs: 1 })).rejects.toThrow(/연결/);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("네트워크 예외도 재시도 대상이다", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(res(done));
    expect((await pollDocument("d1", { fetchImpl, intervalMs: 1 })).verdict).toBe("clear");
  });

  it("상한을 넘기면 PollTimeout", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(base));
    await expect(
      pollDocument("d1", { fetchImpl, intervalMs: 5, timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(PollTimeout);
  });

  it("abort 하면 즉시 멈춘다", async () => {
    const ac = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(async () => {
      ac.abort();
      return res(base);
    });
    await expect(
      pollDocument("d1", { fetchImpl, intervalMs: 50, signal: ac.signal }),
    ).rejects.toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("id 를 URL 에 이스케이프한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(done));
    await pollDocument("../../files", { fetchImpl, intervalMs: 1 });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/documents/..%2F..%2Ffiles");
  });

  it("진행 상황을 알려준다", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(base)).mockResolvedValueOnce(res(done));
    const onTick = vi.fn();
    await pollDocument("d1", { fetchImpl, intervalMs: 1, onTick });
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(onTick.mock.calls[0][1]).toBe(1);
  });
});
