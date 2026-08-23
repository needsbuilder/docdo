// 독도 서비스 워커 — 보호자 푸시 알림 전용. 캐시는 하지 않는다(항상 최신 화면).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = { title: "독도", body: "", url: "/guardian", tag: "docdo" };
  try {
    data = { ...data, ...(e.data ? e.data.json() : {}) };
  } catch {
    /* 본문이 JSON 이 아니면 기본값 */
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      renotify: true,
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/guardian";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
