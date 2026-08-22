import { NextResponse } from "next/server";
import { store, type DocPatch } from "@/lib/store";
import { fetchJob, deleteFile } from "@/lib/upstage";
import { verify } from "@/lib/verify";
import { buildPhrases } from "@/lib/phrase";

export const runtime = "nodejs";

const RESOLUTIONS = new Set(["acknowledged", "done"]);

/** 요청당 Upstage 를 딱 1회 조회한다. 폴링은 브라우저가 한다. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = store();
  const doc = await db.get(id);
  if (!doc) return NextResponse.json({ error: "없음" }, { status: 404 });
  // 이미 판정이 끝난 문서는 다시 Upstage 를 부르지 않는다.
  if (doc.result) return NextResponse.json(doc);
  if (!doc.upstage_job_id) {
    return NextResponse.json({ ...doc, pipeline_status: "error", error: "job id 없음" });
  }

  let job;
  try {
    job = await fetchJob(doc.upstage_job_id);
  } catch (e) {
    return NextResponse.json({
      ...doc,
      pipeline_status: "error",
      error: String(e).slice(0, 200),
    });
  }

  if (job.status === "queued" || job.status === "in_progress") {
    await db.update(id, { pipeline_status: job.status });
    return NextResponse.json({ ...doc, pipeline_status: job.status });
  }

  // failed 는 종결 상태다. 같은 job_id 재조회로는 안 되므로 결과를 그대로 굳힌다.
  const result = verify(job);
  const phrases = buildPhrases(result);
  const updated = await db.update(id, {
    pipeline_status: job.status ?? "failed",
    action_type: result.actionType ?? null,
    verdict: result.verdict,
    result,
    phrases,
  });
  // 원본 사진은 판독이 끝나면 지운다. 실패해도 사용자 흐름을 막지 않는다.
  if (doc.upstage_file_id) await deleteFile(doc.upstage_file_id);
  return NextResponse.json(updated ?? { ...doc, result, phrases, verdict: result.verdict });
}

/** 자녀 화면의 '확인함' · '처리 완료'. 어르신 화면에는 이 경로가 없다. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let resolution: unknown;
  try {
    ({ resolution } = await req.json());
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아닙니다" }, { status: 400 });
  }
  if (typeof resolution !== "string" || !RESOLUTIONS.has(resolution)) {
    return NextResponse.json({ error: "잘못된 값" }, { status: 400 });
  }
  const patch: DocPatch = { resolution_status: resolution };
  patch[resolution === "done" ? "done_at" : "reviewed_at"] = new Date().toISOString();
  const data = await store().update(id, patch);
  if (!data) return NextResponse.json({ error: "없음" }, { status: 404 });
  return NextResponse.json(data);
}
