import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSession, readElderToken, NO_STORE } from "@/lib/auth";
import { store } from "@/lib/store";
import { clientKey, takeToken } from "@/lib/ratelimit";

export const runtime = "nodejs";

// ElevenLabs 음성. 키는 서버에만 있다 — NEXT_PUBLIC_ 금지.
// 읽는 문장은 문구 계층(phrase.ts)이 만든 것뿐이지만, 이 라우트는 공개돼 있으므로
// 가구 인증(어르신 토큰 또는 보호자 세션) + 길이 상한 + 레이트리밋을 건다.

const VOICES = {
  m: "4JJwo477JUAx3HV0T7n7", // Yohan Koo — 기본
  f: "AW5wrnG1jVizOYY7R1Oo", // Jiyoung — 선택
} as const;
type VoiceKey = keyof typeof VOICES;

const MODEL = "eleven_multilingual_v2";
const MAX_CHARS = 300;
const CACHE_MAX = 64;

// 같은 문장은 다시 사지 않는다("다시 듣기"). 인스턴스 메모리 캐시 — 서버리스라 보장은 없다.
const cache = new Map<string, Buffer>();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function authorized(req: Request): Promise<boolean> {
  if (getSession(req)) return true;
  const token = readElderToken(req);
  if (!token) return false;
  const g = await store().guardianByElderToken(token).catch(() => null);
  return !!g;
}

export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json({ error: "음성 서비스가 설정되지 않았습니다" }, 503);
  if (!(await authorized(req))) return json({ error: "없음" }, 404);

  const gate = takeToken(`speech:${clientKey(req)}`);
  if (!gate.ok) return json({ error: "잠시 후 다시 시도해 주세요" }, 429);

  const body = (await req.json().catch(() => null)) as { text?: unknown; voice?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const voice: VoiceKey = body?.voice === "f" ? "f" : "m";
  if (!text || text.length > MAX_CHARS) return json({ error: "읽을 문장이 없거나 너무 깁니다" }, 400);

  const h = createHash("sha1").update(`${voice}\n${text}`).digest("hex");
  let mp3 = cache.get(h);
  if (!mp3) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[voice]}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: 0.9 },
      }),
    }).catch(() => null);
    if (!res || !res.ok) return json({ error: "음성을 만들지 못했습니다" }, 502);
    mp3 = Buffer.from(await res.arrayBuffer());
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(h, mp3);
  }
  return new NextResponse(new Uint8Array(mp3), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" },
  });
}
