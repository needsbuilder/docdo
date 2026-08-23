import "server-only";
import webpush from "web-push";
import { store, type PushSub } from "@/lib/store";

// 보호자 웹 푸시. 키는 서버에만(VAPID_PRIVATE_KEY). 공개키는 /api/guardian/push 로 내려준다.
// 보내는 일은 세 곳뿐: 우편물 판독 완료 · 에이전트가 보호자 차례로 멈춤 · 에이전트 처리 완료.
// 실패해도 본 흐름을 막지 않는다 — 알림은 덤이다. 410/404 는 죽은 구독이라 지운다.

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

let configured: boolean | null = null;
function setup(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:contact@docdo.app";
  if (!pub || !priv) return (configured = false);
  try {
    webpush.setVapidDetails(subject, pub, priv);
    configured = true;
  } catch (e) {
    console.error("[push] VAPID 설정 실패", e);
    configured = false;
  }
  return configured;
}

export const pushConfigured = (): boolean => setup();
export const pushPublicKey = (): string | null => (setup() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null);

/** 가구의 보호자 전원에게. 기기별 구독 전부. 죽은 구독은 정리한다. */
export async function notifyHousehold(householdId: string, payload: PushPayload): Promise<void> {
  if (!setup()) return;
  let guardians;
  try {
    guardians = await store().guardiansByHousehold(householdId);
  } catch (e) {
    console.error("[push] 보호자 조회 실패", e);
    return;
  }
  const body = JSON.stringify({ ...payload, url: payload.url ?? "/guardian" });
  for (const g of guardians) {
    const subs = g.push_subscriptions ?? [];
    if (!subs.length) continue;
    const alive: PushSub[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification(s, body, { TTL: 60 * 30 });
        alive.push(s);
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) continue; // 구독 만료 — 버린다
        console.error("[push] 발송 실패", code, e instanceof Error ? e.message : e);
        alive.push(s);
      }
    }
    if (alive.length !== subs.length) await store().setPushSubscriptions(g.id, alive).catch(() => {});
  }
}
