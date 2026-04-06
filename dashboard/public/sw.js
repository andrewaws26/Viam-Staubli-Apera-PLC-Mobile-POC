const CACHE_VERSION = 'ironsight-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
];

// Install: pre-cache core shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== API_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // API responses: stale-while-revalidate
  if (
    url.pathname.startsWith('/api/sensor-readings') ||
    url.pathname.startsWith('/api/truck-readings')
  ) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  // Static assets (JS, CSS, fonts, images): cache-first
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Navigation and other requests: network-first with cache fallback
  event.respondWith(networkFirst(request, STATIC_CACHE));
});

function isStaticAsset(pathname) {
  return /\.(js|css|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|ico|webp)$/.test(pathname) ||
    pathname.startsWith('/_next/static/');
}

// Cache-first: return cached version, fall back to network
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline — asset not cached', { status: 503 });
  }
}

// Stale-while-revalidate: serve cached immediately, update cache in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => {
      // Network failed — if we have a cached response, it was already returned
      // If not, return an offline indicator
      return null;
    });

  if (cached) {
    // Return cached data immediately; background fetch will update cache
    fetchPromise; // fire-and-forget
    return cached;
  }

  // No cache — must wait for network
  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;

  return new Response(
    JSON.stringify({
      error: 'offline',
      message: 'No cached data available. Connect to the network and refresh.',
    }),
    {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

// Network-first: try network, fall back to cache
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    return new Response('Offline — page not cached', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
