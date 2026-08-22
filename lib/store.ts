import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { VerifyResult } from "./types";
import type { Phrases } from "./phrase";

// 문서 상태 저장소. 어르신 화면이 올리고 자녀 화면이 읽는 같은 행이다.
//
// 어댑터를 둘 둔다:
//   supabase — 배포용. 어르신 폰과 자녀 폰이 서로 다른 서버 인스턴스에 붙어도 같은 행을 본다.
//   file     — 로컬 개발용. Supabase 설정이 없어도 전체 흐름이 돌아간다.
// 배포에서 file 로 떨어지면 인스턴스마다 상태가 갈려 닫힌 루프가 깨진다. 그래서 경고를 남긴다.

export const HOUSEHOLD = "demo";
const LIST_LIMIT = 50;

export type PipelineStatus = "queued" | "in_progress" | "completed" | "failed" | "error";
export type ResolutionStatus = "new" | "acknowledged" | "done";

export type DocRow = {
  id: string;
  household_id: string;
  created_at: string;
  pipeline_status: PipelineStatus | string;
  resolution_status: ResolutionStatus | string;
  upstage_job_id: string | null;
  upstage_file_id: string | null;
  action_type: string | null;
  verdict: string | null;
  result: VerifyResult | null;
  phrases: Phrases | null;
  reviewed_at: string | null;
  done_at: string | null;
};

export type NewDoc = {
  upstage_job_id: string | null;
  upstage_file_id: string | null;
  pipeline_status: string;
};

export type DocPatch = Partial<Omit<DocRow, "id" | "household_id" | "created_at">>;

export interface DocStore {
  insert(doc: NewDoc): Promise<DocRow>;
  list(limit?: number): Promise<DocRow[]>;
  get(id: string): Promise<DocRow | null>;
  update(id: string, patch: DocPatch): Promise<DocRow | null>;
}

function supabaseEnv(): { url: string; key: string } | null {
  // NEXT_PUBLIC_ 접두사를 쓰지 않는다. 서버에서만 부르므로 브라우저 번들에 들어갈 이유가 없다.
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export const storeKind = (): "supabase" | "file" => (supabaseEnv() ? "supabase" : "file");

// ── Supabase ────────────────────────────────────────────────

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  const env = supabaseEnv();
  if (!env) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY 없음");
  client ??= createClient(env.url, env.key, { auth: { persistSession: false } });
  return client;
}

const COLUMNS =
  "id, household_id, created_at, pipeline_status, resolution_status, upstage_job_id, upstage_file_id, action_type, verdict, result, phrases, reviewed_at, done_at";

const supabaseStore: DocStore = {
  async insert(doc) {
    const { data, error } = await supabase()
      .from("documents")
      .insert({ household_id: HOUSEHOLD, ...doc })
      .select(COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return data as DocRow;
  },
  async list(limit = LIST_LIMIT) {
    const { data, error } = await supabase()
      .from("documents")
      .select(COLUMNS)
      .eq("household_id", HOUSEHOLD)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as DocRow[];
  },
  async get(id) {
    const { data } = await supabase().from("documents").select(COLUMNS).eq("id", id).maybeSingle();
    return (data as DocRow | null) ?? null;
  },
  async update(id, patch) {
    const { data, error } = await supabase()
      .from("documents")
      .update(patch)
      .eq("id", id)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as DocRow | null) ?? null;
  },
};

// ── 파일 (로컬 개발용) ────────────────────────────────────────

function dataDir(): string {
  if (process.env.DOCDO_DATA_DIR) return process.env.DOCDO_DATA_DIR;
  // 서버리스에서 쓸 수 있는 유일한 쓰기 가능 경로. 인스턴스 사이에 공유되지 않는다.
  return process.env.VERCEL ? "/tmp/docdo" : ".data";
}

/** 쓰기를 한 줄로 세운다. 동시 요청이 서로의 파일을 덮어쓰지 않게. */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function readAll(): Promise<DocRow[]> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const raw = await readFile(join(dataDir(), "documents.json"), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DocRow[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(rows: DocRow[]): Promise<void> {
  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `documents.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(rows, null, 2), "utf8");
  await rename(tmp, join(dir, "documents.json"));
}

const fileStore: DocStore = {
  insert(doc) {
    return serialize(async () => {
      const rows = await readAll();
      const row: DocRow = {
        id: crypto.randomUUID(),
        household_id: HOUSEHOLD,
        created_at: new Date().toISOString(),
        resolution_status: "new",
        action_type: null,
        verdict: null,
        result: null,
        phrases: null,
        reviewed_at: null,
        done_at: null,
        ...doc,
      };
      rows.push(row);
      await writeAll(rows);
      return row;
    });
  },
  async list(limit = LIST_LIMIT) {
    const rows = await readAll();
    return rows
      .filter((r) => r.household_id === HOUSEHOLD)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  },
  async get(id) {
    return (await readAll()).find((r) => r.id === id) ?? null;
  },
  update(id, patch) {
    return serialize(async () => {
      const rows = await readAll();
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return null;
      rows[i] = { ...rows[i], ...patch };
      await writeAll(rows);
      return rows[i];
    });
  },
};

let warned = false;

export function store(): DocStore {
  if (storeKind() === "supabase") return supabaseStore;
  if (process.env.VERCEL && !warned) {
    warned = true;
    console.warn(
      "[docdo] SUPABASE_URL 이 없어 파일 저장소로 동작합니다. " +
        "배포에서는 인스턴스마다 상태가 갈려 자녀 화면이 문서를 못 찾습니다.",
    );
  }
  return fileStore;
}
