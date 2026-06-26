const CACHE_VERSION = 'mingohome-v2';
const CACHE_NAME = `${CACHE_VERSION}-static`;

const urlsToCache = [
  '/',
  '/index.html',
  '/css/index.css',
  '/bootstrap/css/bootstrap.min.css',
  '/bootstrap-icons/font/bootstrap-icons.min.css',
  '/js/index.mjs',
  '/js/utils/safe-dom.mjs',
  '/js/utils/api.mjs',
  '/js/utils/state.mjs',
  '/js/utils/helpers.mjs',
  '/js/utils/events.mjs',
  '/js/ui/background.mjs',
  '/js/ui/menu.mjs',
  '/js/ui/dashboard.mjs',
  '/js/ui/devices.mjs',
  '/js/ui/prices.mjs',
  '/js/ui/consumption.mjs',
  '/js/ui/weather.mjs',
  '/js/ui/history.mjs',
  '/js/ui/config.mjs',
  '/js/ui/alerts.mjs',
  '/js/ui/mingotouchs.mjs',
  '/js/ui/simulator.mjs',
  '/bootstrap/js/bootstrap.bundle.min.js',
  '/jquery/jquery.min.js',
  '/moment/moment-with-locales.min.js',
  '/chart.js/chart.umd.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
