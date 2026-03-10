const CACHE_NAME = 'todo-app-cache-v2';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/icon.svg',
    '/manifest.json'
];

// Install event: cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event: Network-First strategy
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;
    // Ignore API calls so they are always fresh
    if (event.request.url.includes('/api/')) return;

    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            // Update cache with the new network response
            return caches.open(CACHE_NAME).then((cache) => {
                if (networkResponse.ok) {
                    cache.put(event.request, networkResponse.clone());
                }
                return networkResponse;
            });
        }).catch(() => {
            // Fallback to cache if offline
            return caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
            });
        })
    );
});
