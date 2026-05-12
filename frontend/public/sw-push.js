/* Custom push notification handling, registered alongside the vite-plugin-pwa
 * generated service worker. Loaded by main.tsx if push is supported. */

self.addEventListener("push", (event) => {
  let payload = { title: "Heirloom", body: "Time to check in." };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    /* fallthrough */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url || "/heartbeat" },
      requireInteraction: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/heartbeat";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(url)) return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
