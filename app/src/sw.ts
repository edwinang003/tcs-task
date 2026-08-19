/// <reference lib="webworker" />

/**
 * The service worker, written by hand.
 *
 * SPEC §11.2: `vite-plugin-pwa` runs in `injectManifest` mode — we own this
 * file, and the plugin's only job is replacing `self.__WB_MANIFEST` below with
 * the list of built assets. No Workbox runtime is loaded.
 *
 * P1 adds the `push` and `notificationclick` handlers here (SPEC §10.1 steps
 * 4–5), which is the other reason this file is hand-written: those handlers
 * write to IndexedDB and queue outbox entries without opening a window, and
 * that is not something a generated worker can do for us.
 */

export {}

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

const MANIFEST = self.__WB_MANIFEST

/**
 * Cache name is derived from the build's own content, so a new deploy lands in
 * a new cache and the old one is dropped on activate.
 *
 * SPEC §12 item 7: no user identity in cache names — a second user on this
 * device must not collide with ours.
 */
/**
 * Bumped by hand when this worker's *logic* changes in a way that makes what
 * is already cached wrong. The manifest hash below cannot see such a change —
 * the asset list is identical — so without this the poisoned entry from the
 * redirect bug would sit in the cache until an unrelated asset happened to
 * change.
 */
const LOGIC = 2

const VERSION = (() => {
  let h = 5381
  for (const entry of MANIFEST) {
    const s = entry.url + (entry.revision ?? '')
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  }
  return `${LOGIC}-${h.toString(36)}`
})()

const CACHE = `lane-precache-${VERSION}`

/**
 * The shell is precached under `/`, not `/index.html`.
 *
 * Cloudflare canonicalises `/index.html` to `/` with a 307, so fetching the
 * file by name yields a response whose `redirected` flag is set — and the
 * Fetch spec forbids satisfying a navigation (redirect mode "manual") with a
 * redirected response. The browser turns it into a network error, so every
 * navigation after this worker activates fails: the app opens once, then never
 * again, on every device that visited, until the site's data is cleared.
 *
 * Vite's dev server serves `/index.html` directly, which is why this could
 * only ever appear in production.
 */
const SHELL = '/'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // Dedupe on the *resolved* URL, not the raw string: the injected
      // manifest uses paths relative to the worker's scope, so its
      // "index.html" and our SHELL are the same resource under two names, and
      // `addAll` rejects outright on a duplicate. Getting this wrong fails the
      // whole install, which shows up only as "the app doesn't work offline".
      const urls = new Set(
        MANIFEST.map((e) => new URL(e.url, self.location.href).href),
      )
      // The manifest names the shell `index.html`, which is the spelling that
      // redirects. Drop it in favour of the URL the app is actually launched
      // at — `start_url` and `scope` are both `/`.
      urls.delete(new URL('index.html', self.location.href).href)
      urls.add(new URL(SHELL, self.location.href).href)
      try {
        await cache.addAll([...urls])
      } catch (error) {
        // A silent precache failure is indistinguishable from a working app
        // until the network goes away, so say so loudly.
        console.error('[lane] precache failed', error)
        throw error
      }
      // Deliberately no skipWaiting() here. SPEC §9.8: an update must be a
      // prompt the user accepts, not a swap underneath them — the client sends
      // SKIP_WAITING when they tap Reload.
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('lane-precache-') && name !== CACHE) {
          await caches.delete(name)
        }
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

/**
 * Precache-only. Every navigation is served the app shell from cache, which is
 * what makes the app open instantly and work with no network at all (SPEC §9:
 * "the UI reads and writes IndexedDB" — there is nothing to fetch for data).
 */
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cached = await matchPrecache(SHELL)
        return cached ? safeForNavigation(cached) : fetch(request)
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cached = await matchPrecache(request)
      return cached ?? fetch(request)
    })(),
  )
})

/**
 * `ignoreVary` is not optional here.
 *
 * Precached entries are stored from requests this worker made itself, while
 * lookups come from requests the *page* made — a module script, a stylesheet,
 * a navigation — which carry different headers. Any `Vary` on the response
 * (vite's preview server sends `Vary: Origin`, and CDNs commonly send
 * `Vary: Accept-Encoding`) then makes those two fail to match, the lookup
 * misses, and the worker falls through to a network that is not there.
 *
 * The symptom is the worst kind: perfect online, blank page offline.
 */
function matchPrecache(request: Request | string): Promise<Response | undefined> {
  return caches.match(request, { cacheName: CACHE, ignoreVary: true })
}

/**
 * Belt and braces for the redirect rule above. Caching `/` rather than
 * `/index.html` is the fix; this makes the failure impossible to reintroduce
 * from the serving side, because a host that redirects some other spelling of
 * the shell would brick the app the same way. Rebuilding the response clears
 * the `redirected` flag — the body and headers are the ones we cached.
 */
function safeForNavigation(response: Response): Response {
  if (!response.redirected) return response
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
