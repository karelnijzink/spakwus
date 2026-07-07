// Copyright Nisse Group Ltd
// Push handler imported into the generated Workbox service worker.
/* eslint-disable */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Spakwus", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Spakwus";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: title,
      data: { url: data.url || "/" },
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
