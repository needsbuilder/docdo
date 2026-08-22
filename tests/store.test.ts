import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// 파일 어댑터는 Supabase 없이 로컬에서 전체 흐름을 돌리기 위한 것이다.
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "docdo-store-"));
  process.env.DOCDO_DATA_DIR = dir;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  vi.resetModules();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("store — 어댑터 선택", () => {
  it("배포(VERCEL)에서 Supabase 가 없으면 기동을 막는다", async () => {
    process.env.VERCEL = "1";
    try {
      const { store } = await import("@/lib/store");
      expect(() => store()).toThrow(/SUPABASE_URL/);
    } finally {
      delete process.env.VERCEL;
    }
  });

  it("Supabase 설정이 없으면 파일 저장소", async () => {
    const { storeKind } = await import("@/lib/store");
    expect(storeKind()).toBe("file");
  });

  it("Supabase 설정이 있으면 Supabase", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_ANON_KEY = "k";
    const { storeKind } = await import("@/lib/store");
    expect(storeKind()).toBe("supabase");
  });
});

describe("store — 파일 어댑터", () => {
  it("넣고 읽고 고친다", async () => {
    const { store } = await import("@/lib/store");
    const db = store();
    const row = await db.insert({
      upstage_job_id: "job_1",
      upstage_file_id: "file_1",
      pipeline_status: "queued",
    });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.resolution_status).toBe("new");
    expect(await db.get(row.id)).toMatchObject({ id: row.id, upstage_job_id: "job_1" });

    const updated = await db.update(row.id, { verdict: "clear", pipeline_status: "completed" });
    expect(updated?.verdict).toBe("clear");
    expect((await db.list())[0].verdict).toBe("clear");
  });

  it("없는 id 는 null", async () => {
    const { store } = await import("@/lib/store");
    expect(await store().get("nope")).toBeNull();
    expect(await store().update("nope", { verdict: "clear" })).toBeNull();
  });

  it("최신순으로 준다 — 같은 밀리초에 들어와도", async () => {
    const { store } = await import("@/lib/store");
    const db = store();
    const a = await db.insert({ upstage_job_id: "a", upstage_file_id: null, pipeline_status: "queued" });
    const b = await db.insert({ upstage_job_id: "b", upstage_file_id: null, pipeline_status: "queued" });
    expect((await db.list()).map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it("동시에 넣어도 서로 덮어쓰지 않는다", async () => {
    const { store } = await import("@/lib/store");
    const db = store();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        db.insert({ upstage_job_id: `job_${i}`, upstage_file_id: null, pipeline_status: "queued" }),
      ),
    );
    expect(await db.list()).toHaveLength(20);
    const raw = JSON.parse(await readFile(path.join(dir, "documents.json"), "utf8"));
    expect(raw).toHaveLength(20);
  });
});
