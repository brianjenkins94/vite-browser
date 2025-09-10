// src/vite/worker.ts
const BASE = norm((import.meta as any).env?.BASE_URL || "/");
const VITE_PREFIX = join(BASE, "vite/");
const CHANNEL_NAME = `${VITE_PREFIX}bus`;

function norm(p: string) {
  return (p.endsWith("/") ? p : p + "/").replace(/\/+/g, "/");
}
function join(a: string, b: string) {
  return norm(a.replace(/\/+$/, "/") + b.replace(/^\/+/, ""));
}

const bc = new BroadcastChannel(CHANNEL_NAME);

// Minimal in-memory VFS
const vfs = new Map<string, string>();
const root = join(VITE_PREFIX, "preview/");

function seedDemo() {
  vfs.set(
    join(root, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>Preview</title></head>
<body>
  <h1>Preview served by SW + Worker</h1>
  <p id="from-app"></p>
  <script type="module" src="./app.js"></script>
</body></html>`
  );
  vfs.set(
    join(root, "app.js"),
    `document.getElementById('from-app').textContent =
      'Hello from app.js @ ' + new Date().toISOString();`
  );
}
seedDemo();

function contentType(path: string) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js") || path.endsWith(".mjs"))
    return "application/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

bc.addEventListener("message", (evt) => {
  const msg = evt.data || {};
  if (msg.type === "COMPILE_REQUEST") {
    let key = String(msg.url);
    if (key.endsWith("/preview/")) key += "index.html";
    const body = vfs.get(key);
    if (body == null) {
      bc.postMessage({
        type: "COMPILE_RESPONSE",
        id: msg.id,
        ok: false,
        status: 404,
      });
      return;
    }
    bc.postMessage({
      type: "COMPILE_RESPONSE",
      id: msg.id,
      ok: true,
      status: 200,
      body,
      headers: { "Content-Type": contentType(key) },
    });
  }
});

// Let the world know we’re ready
bc.postMessage({ type: "WORKER_READY" });
