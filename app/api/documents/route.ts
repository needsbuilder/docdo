import { NextResponse } from "next/server";
import { store, storeKind } from "@/lib/store";
import { uploadFile, createJob, deleteFile } from "@/lib/upstage";
import { clientKey, takeToken } from "@/lib/ratelimit";
import { isGuardian, NO_STORE } from "@/lib/auth";
import { toGuardianDoc } from "@/lib/dto";
import { sniffImage } from "@/lib/sniff";

export const runtime = "nodejs";
// 업로드 45초 + job 생성 20초가 30초 안에 끝날 수 없다. 함수 시간을 그에 맞춘다.
export const maxDuration = 60;

// 업로드 상한. Vercel 서버리스 요청 본문 한도(4.5MB)보다 넉넉히 아래로 둔다.
const MAX_BYTES = 4 * 1024 * 1024;

// 인스턴스를 가로지르는 전역 상한. 호출 1건이 Upstage 크레딧 약 $0.04 다.
const GLOBAL_HOURLY_CAP = 40;
const HOUR_MS = 60 * 60 * 1000;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** 저장소를 못 읽으면 **막는다.** 열어두면 insert 는 실패하는데 유료 호출만 나간다. */
async function overGlobalCap(): Promise<boolean | "unknown"> {
  try {
    const since = Date.now() - HOUR_MS;
    const recent = (await store().list(GLOBAL_HOURLY_CAP + 1)).filter(
      (d) => Date.parse(d.created_at) >= since,
    );
    return recent.length >= GLOBAL_HOURLY_CAP;
  } catch {
    return "unknown";
  }
}

/** 사진을 받아 Upstage job 을 만들고 **즉시** 반환한다.
 *  여기서 완료를 기다리면 서버리스 함수가 최대 26초를 붙잡고 있게 된다.
 *
 *  어르신 업로드는 인증하지 않는다 — 어르신에게 로그인을 시킬 수 없다.
 *  대신 속도 제한 + 전역 상한 + 응답에 원문 없음으로 막는다. */
export async function POST(req: Request) {
  const gate = takeToken(clientKey(req));
  if (!gate.ok) {
    return json({ error: "잠시 후 다시 시도해 주세요" }, 429, {
      "Retry-After": String(gate.retryAfterSec),
    });
  }
  const cap = await overGlobalCap();
  if (cap === "unknown") return json({ error: "저장소에 연결하지 못했습니다" }, 503);
  if (cap) {
    return json({ error: "지금은 요청이 많습니다. 잠시 후 다시 시도해 주세요" }, 429, {
      "Retry-After": "300",
    });
  }

  // Content-Length 를 먼저 본다. 본문 전체를 메모리에 올린 뒤 크기를 재면 늦다.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES + 64 * 1024) return json({ error: "사진이 너무 큽니다" }, 413);

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return json({ error: "multipart 형식이 아닙니다" }, 400);
  }
  if (!(file instanceof File)) return json({ error: "file 없음" }, 400);
  if (file.size === 0) return json({ error: "빈 파일" }, 400);
  if (file.size > MAX_BYTES) return json({ error: "사진이 너무 큽니다" }, 413);

  const buf = Buffer.from(await file.arrayBuffer());
  // 선언된 MIME 은 믿지 않는다. 실제 바이트를 본다.
  const kind = sniffImage(buf);
  if (!kind) return json({ error: "지원하지 않는 형식입니다. JPEG·PNG·WebP 만 받습니다" }, 415);

  // 먼저 행을 예약한다. 이후 어느 단계가 실패해도 무엇을 치워야 하는지 남는다.
  const db = store();
  let rowId: string;
  try {
    rowId = (await db.insert({ upstage_job_id: null, upstage_file_id: null, pipeline_status: "uploading" })).id;
  } catch (e) {
    console.error("[documents] insert 실패", e);
    return json({ error: "저장소에 기록하지 못했습니다" }, 503);
  }

  let fileId: string | null = null;
  try {
    fileId = await uploadFile(buf, `mail.${kind.ext}`, kind.mime);
    await db.update(rowId, { upstage_file_id: fileId });

    const job = await createJob(fileId); // 완료를 기다리지 않는다
    if (!job.id) throw new Error("job id 없음");
    await db.update(rowId, { upstage_job_id: job.id, pipeline_status: job.status ?? "queued" });

    return json({ id: rowId, status: "processing" }, 202);
  } catch (e) {
    // 업스트림 오류 본문을 밖에 내보내지 않는다. 로그에만 남긴다.
    console.error("[documents] 업로드/job 생성 실패", rowId, e);
    if (fileId) await deleteFile(fileId);
    await db.update(rowId, {
      pipeline_status: "failed",
      upstage_file_id: fileId ? "delete_pending" : null,
    }).catch(() => {});
    return json({ error: "문서 처리 서비스에 연결하지 못했습니다" }, 502);
  }
}

/** 자녀 전용. 부모님 우편물 원문이 실린다. */
export async function GET(req: Request) {
  if (!isGuardian(req)) return json({ error: "로그인이 필요합니다" }, 401);
  try {
    const rows = await store().list();
    return json({ documents: rows.map(toGuardianDoc), store: storeKind() });
  } catch (e) {
    console.error("[documents] list 실패", e);
    return json({ error: "목록을 읽지 못했습니다" }, 500);
  }
}
