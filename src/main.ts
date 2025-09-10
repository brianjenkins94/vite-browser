import { Workbox } from 'workbox-window';

const statusEl = ensure('#status', () => {
  const p = document.createElement('p'); p.id = 'status'; p.textContent = 'booting…'; document.body.appendChild(p); return p;
});
const logEl = ensure('#log', () => {
  const pre = document.createElement('pre'); pre.id = 'log'; document.body.appendChild(pre); return pre;
});
function ensure<T extends Element>(sel: string, make: () => T): T { return (document.querySelector(sel) as T) || make(); }
function log(s: string) { logEl.textContent += s + '\n'; }

const baseURL   = new URL(import.meta.env.BASE_URL || '/', location.origin);
const viteURL   = new URL('vite/', baseURL);
const swUrl     = new URL('sw.js', viteURL).href;
const workerUrl = new URL('worker.js', viteURL).href;
const previewURL= new URL('preview/', viteURL).href;
const CHANNEL_NAME = viteURL.pathname + 'bus';

// Open BC BEFORE starting worker to avoid missing READY
const bc = new BroadcastChannel(CHANNEL_NAME);
navigator.serviceWorker.addEventListener('message', (evt) => {
  if (evt.data?.type === 'SW_DEBUG') log('[SW] ' + JSON.stringify(evt.data));
});
bc.addEventListener('message', (evt) => {
  const t = evt.data?.type;
  if (t === 'WORKER_READY' || t === 'WORKER_DEBUG' || t === 'PONG_WORKER') {
    log('[WORKER] ' + JSON.stringify(evt.data));
  }
});

(async function boot() {
  // Start bundler worker
  const bundlerWorker = new Worker(workerUrl, { type: 'module' });

  // Register SW as a module
  const wb = new Workbox(swUrl, { scope: viteURL.href, type: 'module' as any });
  wb.addEventListener('waiting', () => wb.messageSkipWaiting());
  wb.addEventListener('controlling', () => location.reload());
  const reg = await wb.register();

  await waitForActivation(reg);
  statusEl.textContent = 'service worker registered';

  await waitForWorkerReady(bc);

  const iframe = document.createElement('iframe');
  iframe.style.width = '100%';
  iframe.style.height = '320px';
  iframe.src = previewURL;
  document.body.appendChild(iframe);

  reg.active?.postMessage({ type: 'PING_FROM_PAGE', at: Date.now() });
})().catch((e) => {
  statusEl.textContent = 'boot failed';
  log(String(e?.stack || e));
});

function waitForActivation(reg: ServiceWorkerRegistration): Promise<void> {
  const sw = reg.installing || reg.waiting || reg.active;
  if (sw && sw.state === 'activated') return Promise.resolve();
  return new Promise((resolve) => {
    const target = reg.installing || reg.waiting || reg.active!;
    if (!target) return resolve();
    const on = () => { if (target.state === 'activated') { target.removeEventListener('statechange', on); resolve(); } };
    target.addEventListener('statechange', on); on();
  });
}

function waitForWorkerReady(bc: BroadcastChannel, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    let ready = false;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'WORKER_READY' || e.data?.type === 'PONG_WORKER') {
        ready = true; bc.removeEventListener('message', onMsg as any); resolve();
      }
    };
    bc.addEventListener('message', onMsg as any);
    const t0 = Date.now();
    (function pingLoop() {
      if (ready) return;
      if (Date.now() - t0 > timeoutMs) { bc.removeEventListener('message', onMsg as any); reject(new Error('Worker not ready')); return; }
      bc.postMessage({ type: 'PING_WORKER' }); setTimeout(pingLoop, 150);
    })();
  });
}
