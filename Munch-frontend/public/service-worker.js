/*
 * What the attendee app keeps, so it opens in a hall with no signal.
 *
 * The shell only. Everything this app is actually for - the transcript
 * being typed, the questions going up, who is on stage - is true for
 * about a minute, and a cached copy of it is worse than a blank screen:
 * somebody would read yesterday's talk and not know it.
 *
 * So the rule is narrow. The built files are cached, because they only
 * change when the app is deployed and their names change when they do.
 * Everything under /api/ and every socket goes to the network and is
 * never stored.
 */
const SHELL = 'manch-shell-v1';

/* Added on install so the app opens at all without a connection. The
   rest of the build is picked up as it is asked for. */
const ALWAYS = ['/', '/index.html', '/manifest.json', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(ALWAYS))
      // A missing file must not leave the worker uninstalled for ever.
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== SHELL).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

/** Whether this is the app itself rather than something it is asking for. */
const isShell = (url) =>
  url.origin === self.location.origin
  && !url.pathname.startsWith('/api/')
  && !url.pathname.startsWith('/ws/')
  && !url.pathname.startsWith('/media/')
  && !url.pathname.startsWith('/admin/');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isShell(url)) return;

  // A page request is answered from the network when there is one, so a
  // deploy is picked up on the next load rather than the one after; the
  // cached shell is the fallback for a hall with no signal.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((answer) => {
          const copy = answer.clone();
          caches.open(SHELL).then((cache) => cache.put('/index.html', copy));
          return answer;
        })
        .catch(() => caches.match('/index.html').then(
          (cached) => cached || Response.error()
        ))
    );
    return;
  }

  // Built files carry a hash in the name, so a hit is always the right
  // file and there is no reason to ask again.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((answer) => {
      if (answer.ok && answer.type === 'basic') {
        const copy = answer.clone();
        caches.open(SHELL).then((cache) => cache.put(request, copy));
      }
      return answer;
    }))
  );
});
