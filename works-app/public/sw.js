let badgeCount = 0;

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  badgeCount++;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: data.url || "/" },
      }),
      navigator.setAppBadge ? navigator.setAppBadge(badgeCount) : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  badgeCount = 0;
  if (navigator.clearAppBadge) navigator.clearAppBadge();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) { client.focus(); return; }
      }
      return clients.openWindow(url);
    })
  );
});
