// lazylink service worker: makes the app installable, caches the shell, shows push notifications,
// and receives files from the Android share sheet. API calls, events, media and downloads always hit
// the network (they need your Mac).
const CACHE = "lazylink-shell-v2";
const SHARE_CACHE = "lazylink-share";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

/** Android share sheet → POST /share (multipart). Stash the files, then open the app to upload them. */
async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open(SHARE_CACHE);
  let i = 0;
  for (const file of form.getAll("files")) {
    if (!(file instanceof File)) continue;
    await cache.put(
      `/shared/${Date.now()}-${i++}`,
      new Response(file, { headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) } }),
    );
  }
  const text = [form.get("title"), form.get("text"), form.get("url")].filter(Boolean).join("\n");
  const params = new URLSearchParams({ shared: "1" });
  if (text) params.set("text", text);
  return Response.redirect(`/?${params}`, 303);
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method === "POST" && url.pathname === "/share") return e.respondWith(receiveShare(e.request));
  if (e.request.method !== "GET") return;
  if (/^\/(api|auth|media|files|mcp)\//.test(url.pathname)) return;
  // Network first, falling back to the cached shell when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (e.request.mode === "navigate" || url.pathname.startsWith("/assets/"))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request.mode === "navigate" ? "/" : e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request.mode === "navigate" ? "/" : e.request)),
  );
});

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: "lazylink", body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(data.title || "lazylink", {
      body: data.body || "",
      tag: data.tag,
      renotify: !!data.tag,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "/", location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const win = windows.find((w) => new URL(w.url).origin === location.origin);
      if (win) return win.navigate(target).then((w) => (w ?? win).focus());
      return self.clients.openWindow(target);
    }),
  );
});
