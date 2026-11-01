/*
 * RelayFiles service worker (docs/architecture.md "설치 앱과 공유 대상"). Its only job is the
 * Web Share Target: files shared from another app arrive as a POST navigation, which this worker
 * answers itself. It caches nothing and lets every other request go to the network untouched.
 *
 * Why here and not on the server: the session cookie is SameSite=Lax, which browsers do not send
 * with a POST navigation that another app or site started, so the server could not tell whose
 * Home the files belong to. The worker keeps the files in memory, opens the share page with an
 * id, and hands them to that page (same origin) when it asks; the page shows them and uploads
 * them with the normal tus flow, signed in, after the user confirms.
 *
 * The values below repeat SHARE_TARGET in src/config/policy.ts (src/features/pwa/pwa.test.ts
 * checks that they match).
 */
const SHARE_ACTION = "/share-target/receive";
const SHARE_PAGE = "/share-target";
const FILES_FIELD = "files";
const HOLD_MS = 180000;

/** Shared files waiting for their page: id -> { files, release }. Memory only, never stored. */
const pending = new Map();

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function isShare(request) {
  const url = new URL(request.url);
  return request.method === "POST" && url.origin === self.location.origin && url.pathname === SHARE_ACTION;
}

self.addEventListener("fetch", (event) => {
  if (!isShare(event.request)) return;
  const id = crypto.randomUUID();
  let release = () => {};
  // Keeps the worker alive until the page took the files, or drops them after HOLD_MS.
  const held = new Promise((resolve) => {
    const timer = setTimeout(resolve, HOLD_MS);
    release = () => {
      clearTimeout(timer);
      resolve();
    };
  }).then(() => pending.delete(id));
  event.waitUntil(held);
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const files = form.getAll(FILES_FIELD).filter((value) => value instanceof File);
        pending.set(id, { files, release });
        return Response.redirect(`${SHARE_PAGE}?share=${id}`, 303);
      } catch {
        release();
        return Response.redirect(`${SHARE_PAGE}?error=unreadable`, 303);
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  const port = event.ports[0];
  if (!port || !data || data.type !== "share-files" || typeof data.id !== "string") return;
  const entry = pending.get(data.id);
  // Handed out once: a second page (or a reload) gets nothing.
  pending.delete(data.id);
  port.postMessage({ files: entry ? entry.files : null });
  if (entry) entry.release();
});
