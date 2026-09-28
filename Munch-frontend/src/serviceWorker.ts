/**
 * Registering the worker that lets the app open without a connection.
 *
 * Only in a build, and only where the browser has one: the development
 * server rebuilds constantly and a worker serving a cached shell over
 * the top of that is a morning of wondering why a change will not
 * appear.
 */
export const registerServiceWorker = (): void => {
  if (process.env.NODE_ENV !== 'production') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${process.env.PUBLIC_URL}/service-worker.js`)
      .catch(() => {
        // An app that cannot register one still works; it just will not
        // open without a connection. Not worth troubling anybody with.
      });
  });
};
