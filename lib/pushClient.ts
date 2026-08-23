// 보호자 폰에서 푸시를 켠다. iOS 는 홈 화면에 추가한 웹앱에서만 되고, 권한 요청은 사용자 제스처 안에서만.

export type PushState = "unsupported" | "needs-install" | "off" | "on" | "denied" | "unconfigured";

function isIosSafariTab(): boolean {
  if (typeof navigator === "undefined") return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return isIosSafariTab() ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const r = await fetch("/api/guardian/push").then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (!r?.configured) return "unconfigured";
  const reg = await navigator.serviceWorker.getRegistration("/sw.js").catch(() => undefined);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function b64ToU8(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** 사용자 제스처 안에서 부른다. 권한 → 구독 → 서버 저장. */
export async function enablePush(): Promise<PushState> {
  const r = await fetch("/api/guardian/push").then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (!r?.configured || !r.publicKey) return "unconfigured";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(r.publicKey) as BufferSource }));
  const res = await fetch("/api/guardian/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  return res.ok ? "on" : "off";
}
