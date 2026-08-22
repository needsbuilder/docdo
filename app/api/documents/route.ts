import { NextResponse } from "next/server";
import { store, storeKind } from "@/lib/store";
import { uploadFile, createJob } from "@/lib/upstage";

export const runtime = "nodejs";
export const maxDuration = 30;

// 업로드 상한. Vercel 서버리스 요청 본문 한도(4.5MB)보다 넉넉히 아래로 둔다.
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/** 사진을 받아 Upstage job 을 만들고 **즉시** 반환한다.
 *  여기서 완료를 기다리면 서버리스 함수가 최대 26초를 붙잡고 있게 된다. */
export async function POST(req: Request) {
  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "multipart 형식이 아닙니다" }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "file 없음" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "빈 파일" }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "사진이 너무 큽니다" }, { status: 413 });
  }
  const mime = file.type || "image/jpeg";
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: `지원하지 않는 형식: ${mime}` }, { status: 415 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const fileId = await uploadFile(buf, file.name || "upload.jpg", mime);
    const job = await createJob(fileId); // 완료를 기다리지 않는다
    const row = await store().insert({
      upstage_job_id: job.id ?? null,
      upstage_file_id: fileId,
      pipeline_status: job.status ?? "queued",
    });
    return NextResponse.json(
      { id: row.id, jobId: job.id, status: "processing" },
      { status: 202 },
    );
  } catch (e) {
    // 예외 메시지에 우리 키는 들어가지 않는다. lib/upstage.ts 참고.
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}

export async function GET() {
  try {
    return NextResponse.json({ documents: await store().list(), store: storeKind() });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
