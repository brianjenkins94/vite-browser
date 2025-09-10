// --- path utils ---
function dir(p: string) {
  const s = ('/' + p).replace(/\/+/g, '/');
  return s.endsWith('/') ? s : s + '/';
}
function pathJoin(...segs: string[]) {
  return ('/' + segs.map(s => s.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')).replace(/\/+/g, '/');
}

const BASE         = dir((import.meta as any).env?.BASE_URL || '/');
const VITE_PREFIX  = dir(pathJoin(BASE, 'vite'));
const CHANNEL_NAME = `${VITE_PREFIX}bus`;

const bc = new BroadcastChannel(CHANNEL_NAME);

// Minimal in-memory VFS
const vfs = new Map<string, string>();
const root = dir(pathJoin(VITE_PREFIX, 'preview')); // directory with trailing slash

// Seed demo files with FILE paths (no trailing slash)
vfs.set(pathJoin(root, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><title>Preview</title></head>
<body>
  <h1>Preview served by SW + Worker</h1>
  <p id="from-app"></p>
  <script type="module" src="./app.js"></script>
</body></html>`);

vfs.set(pathJoin(root, 'app.js'),
  `document.getElementById('from-app').textContent =
   'Hello from app.js @ ' + new Date().toISOString();`
);

bc.addEventListener('message', (evt) => {
  const msg = evt.data || {};
  if (msg.type === 'PING_WORKER') {
    bc.postMessage({ type: 'PONG_WORKER' });
  }
  if (msg.type === 'COMPILE_REQUEST') {
    let key = String(msg.url);
    if (key.endsWith('/preview/')) key = pathJoin(key, 'index.html'); // ensure no trailing slash

    // Debug: tell page exactly what we looked up
    bc.postMessage({ type: 'WORKER_DEBUG', lookedUp: key, has: vfs.has(key) });

    const body = vfs.get(key);
    if (body == null) {
      bc.postMessage({ type: 'COMPILE_RESPONSE', id: msg.id, ok: false, status: 404 });
      return;
    }
    bc.postMessage({
      type: 'COMPILE_RESPONSE',
      id: msg.id,
      ok: true,
      status: 200,
      body,
      headers: { 'Content-Type': contentType(key) },
    });
  }
});

function contentType(path: string) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

// Announce readiness after listeners are attached
bc.postMessage({ type: 'WORKER_READY' });
