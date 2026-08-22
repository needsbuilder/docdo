import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { VerifyResult } from "./types";
import type { Phrases } from "./phrase";

// 문서 상태 저장소. 어르신 화면이 올리고 자녀 화면이 읽는 같은 행이다.
//
// 어댑터를 둘 둔다:
//   supabase — 배포용. 어르신 폰과 자녀 폰이 서로 다른 서버 인스턴스에 붙어도 같은 행을 본다.
//   file     — 로컬 개발용. Supabase 설정이 없어도 전체 흐름이 돌아간다.
// 배포에서 file 로 떨어지면 인스턴스마다 상태가 갈려 닫힌 루프가 깨진다. 그래서 배포에서는 막는다.
// 파일 어댑터는 **프로세스 하나**에서만 안전하다. 여러 프로세스가 같은 파일을 쓰면 서로 덮어쓴다.

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
  // 에이전트 실행. 보호자가 승인하면 queued, 워커가 집으면 running, 끝나면 done/blocked/failed.
  action_status: ActionStatus | string;
  action_trace: TraceStep[];
  action_result: ActionResult | null;
  approved_at: string | null;
};

export type ActionStatus = "none" | "queued" | "running" | "done" | "blocked" | "failed";
export type TraceStep = { t: string; title: string; detail?: string; shot?: string };
export type ActionResult = { summary: string; receipt?: string; reason?: string };

export type NewDoc = {
  household_id: string;
  upstage_job_id: string | null;
  upstage_file_id: string | null;
  pipeline_status: string;
};

export type DocPatch = Partial<Omit<DocRow, "id" | "household_id" | "created_at">>;

export type Guardian = {
  id: string;
  email: string;
  password_hash: string;
  household_id: string;
  elder_token: string;
  created_at: string;
};

export type NewGuardian = Omit<Guardian, "id" | "created_at" | "household_id"> & { household_id?: string };

export interface DocStore {
  insert(doc: NewDoc): Promise<DocRow>;
  /** 가구 단위. 다른 가구의 문서는 존재하지 않는 것처럼 다룬다. */
  list(householdId: string, limit?: number): Promise<DocRow[]>;
  get(id: string): Promise<DocRow | null>;
  update(id: string, patch: DocPatch): Promise<DocRow | null>;
  /** 전역 상한용. 가구와 무관하게 최근 N건. */
  recent(limit: number): Promise<DocRow[]>;

  createGuardian(g: NewGuardian): Promise<Guardian>;
  guardianByEmail(email: string): Promise<Guardian | null>;
  guardianById(id: string): Promise<Guardian | null>;
  guardianByElderToken(token: string): Promise<Guardian | null>;

  /** 워커용. 승인된 문서 하나를 집어 running 으로 바꾼다. 없으면 null. */
  claimAction(): Promise<DocRow | null>;
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
  "id, household_id, created_at, pipeline_status, resolution_status, upstage_job_id, upstage_file_id, action_type, verdict, result, phrases, reviewed_at, done_at, action_status, action_trace, action_result, approved_at";
const G_COLUMNS = "id, email, password_hash, household_id, elder_token, created_at";

async function gOne(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Guardian | null> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as Guardian | null) ?? null;
}

const supabaseStore: DocStore = {
  async insert(doc) {
    const { data, error } = await supabase().from("documents").insert(doc).select(COLUMNS).single();
    if (error) throw new Error(error.message);
    return data as DocRow;
  },
  async list(householdId, limit = LIST_LIMIT) {
    const { data, error } = await supabase()
      .from("documents")
      .select(COLUMNS)
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as DocRow[];
  },
  async recent(limit) {
    const { data, error } = await supabase()
      .from("documents")
      .select(COLUMNS)
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
  async claimAction() {
    const { data, error } = await supabase()
      .from("documents")
      .select(COLUMNS)
      .eq("action_status", "queued")
      .order("approved_at", { ascending: true })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as DocRow | undefined;
    if (!row) return null;
    // 같은 행을 둘이 집는 경쟁은 조건부 갱신으로 막는다.
    const { data: got, error: e2 } = await supabase()
      .from("documents")
      .update({ action_status: "running" })
      .eq("id", row.id)
      .eq("action_status", "queued")
      .select(COLUMNS);
    if (e2) throw new Error(e2.message);
    return ((got ?? [])[0] as DocRow | undefined) ?? null;
  },
  async createGuardian(g) {
    const { data, error } = await supabase().from("guardians").insert(g).select(G_COLUMNS).single();
    if (error) {
      if (error.code === "23505") throw new Error("DUPLICATE_EMAIL");
      throw new Error(error.message);
    }
    return data as Guardian;
  },
  guardianByEmail(email) {
    return gOne(supabase().from("guardians").select(G_COLUMNS).eq("email", email).maybeSingle());
  },
  guardianById(id) {
    return gOne(supabase().from("guardians").select(G_COLUMNS).eq("id", id).maybeSingle());
  },
  guardianByElderToken(token) {
    return gOne(supabase().from("guardians").select(G_COLUMNS).eq("elder_token", token).maybeSingle());
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

async function readJson<T>(name: string): Promise<T[]> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  let raw: string;
  try {
    raw = await readFile(join(dataDir(), name), "utf8");
  } catch (e) {
    // 파일이 아직 없는 것만 빈 목록이다. 권한·I/O 오류를 빈 목록으로 바꾸면
    // 다음 insert 가 기존 데이터를 통째로 지운다.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const parsed = JSON.parse(raw); // 깨진 JSON 은 그대로 던진다
  if (!Array.isArray(parsed)) throw new Error(`${name} 이 배열이 아님`);
  return parsed as T[];
}

async function writeJson<T>(name: string, rows: T[]): Promise<void> {
  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${name}.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(rows, null, 2), "utf8");
  await rename(tmp, join(dir, name));
}

const readAll = () => readJson<DocRow>("documents.json");
const writeAll = (rows: DocRow[]) => writeJson("documents.json", rows);
const readGuardians = () => readJson<Guardian>("guardians.json");
const writeGuardians = (rows: Guardian[]) => writeJson("guardians.json", rows);

const fileStore: DocStore = {
  insert(doc) {
    return serialize(async () => {
      const rows = await readAll();
      const row: DocRow = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        resolution_status: "new",
        action_type: null,
        verdict: null,
        result: null,
        phrases: null,
        reviewed_at: null,
        done_at: null,
        action_status: "none",
        action_trace: [],
        action_result: null,
        approved_at: null,
        ...doc,
      };
      rows.push(row);
      await writeAll(rows);
      return row;
    });
  },
  async list(householdId, limit = LIST_LIMIT) {
    const rows = await readAll();
    // 같은 밀리초에 들어온 행이 있을 수 있다. 그때는 나중에 넣은 것이 먼저다.
    return rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.household_id === householdId)
      .sort((a, b) => b.r.created_at.localeCompare(a.r.created_at) || b.i - a.i)
      .slice(0, limit)
      .map(({ r }) => r);
  },
  async recent(limit) {
    const rows = await readAll();
    return rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.created_at.localeCompare(a.r.created_at) || b.i - a.i)
      .slice(0, limit)
      .map(({ r }) => r);
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
  claimAction() {
    return serialize(async () => {
      const rows = await readAll();
      const q = rows.filter((r) => r.action_status === "queued").sort((a, b) => (a.approved_at ?? "").localeCompare(b.approved_at ?? ""));
      if (!q.length) return null;
      const i = rows.findIndex((r) => r.id === q[0].id);
      rows[i] = { ...rows[i], action_status: "running" };
      await writeAll(rows);
      return rows[i];
    });
  },
  createGuardian(g) {
    return serialize(async () => {
      const rows = await readGuardians();
      if (rows.some((r) => r.email === g.email)) throw new Error("DUPLICATE_EMAIL");
      const row: Guardian = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        household_id: g.household_id ?? crypto.randomUUID(),
        email: g.email,
        password_hash: g.password_hash,
        elder_token: g.elder_token,
      };
      rows.push(row);
      await writeGuardians(rows);
      return row;
    });
  },
  async guardianByEmail(email) {
    return (await readGuardians()).find((r) => r.email === email) ?? null;
  },
  async guardianById(id) {
    return (await readGuardians()).find((r) => r.id === id) ?? null;
  },
  async guardianByElderToken(token) {
    return (await readGuardians()).find((r) => r.elder_token === token) ?? null;
  },
};

export function store(): DocStore {
  if (storeKind() === "supabase") return supabaseStore;
  // 서버리스에서 파일 저장소는 인스턴스마다 따로 논다. 자녀 화면이 문서를 못 찾고,
  // 전역 상한도 세지 못한다. 경고로 넘기지 않고 막는다.
  if (process.env.VERCEL) {
    throw new Error("배포 환경에는 SUPABASE_URL / SUPABASE_ANON_KEY 가 필요합니다");
  }
  return fileStore;
}
