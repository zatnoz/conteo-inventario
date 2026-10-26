/* Service worker — Conteo de Inventario
   SUBA VERSION en cada publicación: así los teléfonos detectan la versión nueva y muestran «Hay una versión nueva – Actualizar». */
const VERSION = '11.1.0';
const SHELL = 'shell-' + VERSION;      // app + íconos + manifest (se reemplaza en cada versión)
const LIBS  = 'libs-v1';               // librerías de CDN y datos del OCR (se conservan entre versiones)

const SHELL_URLS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
                    './icon-maskable-512.png', './apple-touch-icon.png', './favicon-32.png'];
const CDN_PRECACHE = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.6/dist/iife/reader/index.js',
  'https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.6/dist/reader/zxing_reader.wasm',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'tessdata.projectnaptha.com', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_URLS.map(u => new Request(u, { cache: 'reload' })));   // lo esencial: si falla, no se instala
    const libs = await caches.open(LIBS);
    await Promise.all(CDN_PRECACHE.map(async u => {                                  // las librerías: mejor esfuerzo
      try { if (!(await libs.match(u))) { const r = await fetch(new Request(u, { mode: 'cors', credentials: 'omit' })); if (r.ok) await libs.put(u, r) } } catch (_) {}
    }));
    if (!self.registration.active) self.skipWaiting();                               // primera instalación: activar ya
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d.type === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'VERSION', version: VERSION });
});

async function cdnFetch(req) {            // petición CORS (las respuestas opacas ocupan mucha cuota)
  try { return await fetch(new Request(req.url, { mode: 'cors', credentials: 'omit' })); }
  catch (_) { return fetch(req); }
}
const storable = r => r && r.status === 200 && (r.type === 'cors' || r.type === 'basic');

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url) } catch (_) { return }
  // Supabase (API, auth, realtime, storage): SIEMPRE red, nunca caché ni intervención del service worker
  if (/(^|\.)supabase\.(co|in)$/.test(url.hostname)) return;

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    e.respondWith((async () => {
      const shell = await caches.open(SHELL);
      const hit = await shell.match(req.mode === 'navigate' ? './index.html' : req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { try { return await fetch(req) } catch (_) { return Response.error() } }
      return fetch(req);                   // p. ej. catalogo_ejemplo.xlsx: red
    })());
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    if (req.headers.has('range')) return;
    const floating = /@\d+(\/|$)/.test(url.pathname);   // p. ej. tesseract.js@5 → revalidar en segundo plano
    e.respondWith((async () => {
      const libs = await caches.open(LIBS);
      const hit = await libs.match(req.url);
      const refresh = () => cdnFetch(req).then(r => { if (storable(r)) libs.put(req.url, r.clone()); return r });
      if (hit) { if (floating) e.waitUntil(refresh().catch(() => {})); return hit }
      return refresh();
    })());
  }
});
