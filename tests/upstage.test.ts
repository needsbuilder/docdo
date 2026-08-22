import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  process.env.UPSTAGE_API_KEY = "up_test_secret_value";
  process.env.UPSTAGE_AGENT_ID = "agt_test";
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type FetchCall = [string, { method?: string; body?: unknown; headers?: Record<string, string> }];

function mockOk(json: unknown) {
  const m = vi.fn().mockResolvedValue({ ok: true, json: async () => json });
  vi.stubGlobal("fetch", m);
  return m;
}

describe("upstage — createJob", () => {
  it("include:['all'] 로 호출한다 (['last'] 면 Extract 필드·confidence·location 이 사라진다)", async () => {
    const fetchMock = mockOk({ id: "job_1", status: "queued" });
    const { createJob } = await import("@/lib/upstage");
    await createJob("file_1");
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://api.upstage.ai/v2/responses");
    expect(init.method).toBe("POST");
    expect(body.include).toEqual(["all"]);
    expect(body.model).toBe("agt_test");
    expect(body.input[0].content[0]).toEqual({ type: "input_file", file_id: "file_1" });
  });

  it("Authorization 헤더에 Bearer 키를 싣는다", async () => {
    const fetchMock = mockOk({ id: "job_1", status: "queued" });
    const { createJob } = await import("@/lib/upstage");
    await createJob("file_1");
    const [, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(init.headers?.Authorization).toBe("Bearer up_test_secret_value");
  });

  it("키가 없으면 호출 전에 던진다", async () => {
    delete process.env.UPSTAGE_API_KEY;
    const fetchMock = mockOk({ id: "job_1" });
    const { createJob } = await import("@/lib/upstage");
    await expect(createJob("file_1")).rejects.toThrow(/UPSTAGE_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("에이전트 ID가 없으면 호출 전에 던진다", async () => {
    delete process.env.UPSTAGE_AGENT_ID;
    const fetchMock = mockOk({ id: "job_1" });
    const { createJob } = await import("@/lib/upstage");
    await expect(createJob("file_1")).rejects.toThrow(/UPSTAGE_AGENT_ID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("upstage — fetchJob", () => {
  it("한 번만 조회하고 폴링하지 않는다 (API Route 안에서 while/sleep 금지)", async () => {
    const fetchMock = mockOk({ id: "job_1", status: "in_progress" });
    const { fetchJob } = await import("@/lib/upstage");
    const r = await fetchJob("job_1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((r as { status: string }).status).toBe("in_progress");
  });

  it("조회에도 include[]=all 을 붙인다", async () => {
    const fetchMock = mockOk({ id: "job_1", status: "completed" });
    const { fetchJob } = await import("@/lib/upstage");
    await fetchJob("job_1");
    const [url] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe("https://api.upstage.ai/v2/responses/job_1?include[]=all");
  });

  it("job id 를 URL 에 이스케이프한다", async () => {
    const fetchMock = mockOk({ id: "x", status: "completed" });
    const { fetchJob } = await import("@/lib/upstage");
    await fetchJob("job/../../files");
    const [url] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toContain("job%2F..%2F..%2Ffiles");
  });

  it("HTTP 오류는 예외로 던진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" }),
    );
    const { fetchJob } = await import("@/lib/upstage");
    await expect(fetchJob("job_x")).rejects.toThrow(/404/);
  });

  it("오류 메시지에 API 키가 새지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "invalid key",
      }),
    );
    const { fetchJob } = await import("@/lib/upstage");
    await expect(fetchJob("job_x")).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("up_test_secret_value") as unknown as string,
      }),
    );
  });
});

describe("upstage — uploadFile", () => {
  it("purpose=user_data 와 파일을 multipart 로 보낸다", async () => {
    const fetchMock = mockOk({ id: "file_9" });
    const { uploadFile } = await import("@/lib/upstage");
    const id = await uploadFile(Buffer.from("fake-jpeg"), "mail.jpg", "image/jpeg");
    expect(id).toBe("file_9");
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe("https://api.upstage.ai/v2/files");
    const fd = init.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get("purpose")).toBe("user_data");
    const file = fd.get("file") as File;
    expect(file).toBeTruthy();
    expect(await file.text()).toBe("fake-jpeg");
  });

  it("Content-Type 을 직접 넣지 않는다 (boundary 를 fetch 가 붙여야 한다)", async () => {
    const fetchMock = mockOk({ id: "file_9" });
    const { uploadFile } = await import("@/lib/upstage");
    await uploadFile(Buffer.from("x"), "mail.jpg", "image/jpeg");
    const [, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(init.headers?.["Content-Type"]).toBeUndefined();
  });
});

describe("upstage — deleteFile", () => {
  it("DELETE 를 보낸다", async () => {
    const fetchMock = mockOk({});
    const { deleteFile } = await import("@/lib/upstage");
    await deleteFile("file_9");
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe("https://api.upstage.ai/v2/files/file_9");
    expect(init.method).toBe("DELETE");
  });

  it("삭제 실패는 흐름을 막지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { deleteFile } = await import("@/lib/upstage");
    await expect(deleteFile("file_9")).resolves.toBeUndefined();
  });
});
