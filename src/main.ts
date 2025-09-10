// src/main.ts
// Parent page that: (1) registers the SW at <BASE>vite/sw.js with scope <BASE>vite/,
// (2) spins up an inline Worker that pretends to be "browser-vite", and
// (3) embeds an <iframe src="<BASE>vite/preview/"> that is served via SW+Worker.

const BASE = normalizeBase(import.meta.env.BASE_URL || "/"); // e.g. "/" or "/repo-name/"
const VITE_PREFIX = join(BASE, "vite/");                     // e.g. "/vite/" or "/repo-name/vite/"
const CHANNEL_NAME = `${VITE_PREFIX}bus`;                    // shared BroadcastChannel for window/SW/Worker

function normalizeBase(b: string) {
  return (b.endsWith("/") ? b : b + "/").replace(/\/+/g, "/");
}
function join(a: string, b: string) {
  return normalizeBase(a.replace(/\/+$/, "/") + b.replace(/^\/+/, ""));
}

// ----- UI bits (optional) -----
const status = document.createElement("p");
status.id = "status";
status.textContent = "registering service worker…";
document.body.appendChild(status);

const logEl = document.createElement("pre");
logEl.id = "log";
document.body.appendChild(logEl);

function log(line: string) {
  logEl.textContent += line + "\n";
}

// ----- Inline "bundler" Worker -----
// We embed the worker code right here so you still only have 2 files.
const workerSrc = `
  const BASE = ${JSON.stringify(BASE)};
  const VITE_PREFIX = ${JSON.stringify(VITE_PREFIX)};
  const CHANNEL_NAME = ${JSON.stringify(CHANNEL_NAME)};

  const bc = new BroadcastChannel(CHANNEL_NAME);
  const vfs = new Map(); // in-memory files keyed by absolute path (pathname)

  // Helpers
  const contentType = (path) => {
    if (path.endsWith(".html")) return "text/html; charset=utf-8";
    if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript; charset=utf-8";
    if (path.endsWith(".css")) return "text/css; charset=utf-8";
    if (path.endsWith(".json")) return "application/json; charset=utf-8";
    return "text/plain; charset=utf-8";
  };

  // Minimal demo files. In a real app the parent would push user files here.
  function loadDemoFiles() {
    const root = VITE_PREFIX + "preview/";
    vfs.set(root + "index.html", \`<!doctype html>
<html><head><meta charset="utf-8"><title>Preview</title></head>
<body>
  <h1>Preview served by SW+Worker</h1>
  <p id="from-app"></p>
  <script type="module" src="./app.js"></script>
</body></html>\`);
    vfs.set(root + "app.js", \`
      document.getElementById('from-app').textContent =
        'Hello from app.js @ ' + new Date().toISOString();
      console.log('app.js loaded');
    \`);
  }
  loadDemoFiles();

  // Accept VFS updates from the parent (optional)
  bc.addEventListener("message", (evt) => {
    const msg = evt.data || {};
    if (msg.type === "VFS_SET" && msg.files && typeof msg.files === "object") {
      for (const [path, body] of Object.entries(msg.files)) {
        vfs.set(path, String(body));
      }
      bc.postMessage({ type: "VFS_OK" });
    }
    if (msg.type === "PING_WORKER") {
      bc.postMessage({ type: "PONG_WORKER" });
    }
    if (msg.type === "COMPILE_REQUEST") {
      const { id, url } = msg;
      // Normalize "/.../preview/" -> "/.../preview/index.html"
      let key = url;
      if (key.endsWith("/preview/")) key += "index.html";
      // Find file
      const body = vfs.get(key);
      if (body == null) {
        bc.postMessage({ type: "COMPILE_RESPONSE", id, ok: false, status: 404 });
        return;
      }
      const headers = { "Content-Type": contentType(key) };
      bc.postMessage({ type: "COMPILE_RESPONSE", id, ok: true, status: 200, body, headers });
    }
  });

  // Announce readiness
  bc.postMessage({ type: "WORKER_READY" });
`;
const worker = new Worker(
  URL.createObjectURL(new Blob([workerSrc], { type: "text/javascript" })),
  { type: "module" }
);

// Shared channel (window <-> worker <-> SW)
const bc = new BroadcastChannel(CHANNEL_NAME);

// Wait for worker to come up
const waitFor = (pred: () => boolean, timeoutMs = 5000) =>
  new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => (pred() ? resolve() : Date.now() - t0 > timeoutMs ? reject(new Error("timeout")) : setTimeout(tick, 20));
    tick();
  });

let workerReady = false;
bc.addEventListener("message", (e) => {
  const m = e.data || {};
  if (m.type === "WORKER_READY") {
    workerReady = true;
    log("worker: ready");
  }
  if (m.type === "VFS_OK") log("worker: vfs updated");
  if (m.type === "PONG_WORKER") log("worker: pong");
});

// ----- Register the Service Worker -----
async function setup() {
  if (!("serviceWorker" in navigator)) {
    status.textContent = "service worker not supported";
    return;
  }

  // Register at <BASE>vite/sw.js with scope <BASE>vite/
  const swUrl = join(VITE_PREFIX, "sw.js");
  const reg = await navigator.serviceWorker.register(swUrl, { scope: VITE_PREFIX });
  await navigator.serviceWorker.ready;
  status.textContent = "service worker registered";

  // SW message roundtrip (as requested)
  navigator.serviceWorker.addEventListener("message", (evt) => {
    log("from SW: " + JSON.stringify(evt.data));
  });
  reg.active?.postMessage({ type: "PING_FROM_PAGE", at: Date.now() });

  // Make sure the worker is listening
  if (!workerReady) {
    // poke the worker and wait for its reply
    const once = new Promise<void>((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data?.type === "PONG_WORKER") {
          bc.removeEventListener("message", handler as any);
          resolve();
        }
      };
      bc.addEventListener("message", handler as any);
    });
    bc.postMessage({ type: "PING_WORKER" });
    await Promise.race([once, waitFor(() => workerReady)]);
  }

  // (Optional) Push/override demo files via VFS channel
  // bc.postMessage({ type: "VFS_SET", files: { [join(VITE_PREFIX, "preview/extra.txt")]: "Hello!" } });

  // Create the preview iframe under the SW scope
  const iframe = document.createElement("iframe");
  iframe.style.width = "100%";
  iframe.style.height = "300px";
  iframe.src = join(VITE_PREFIX, "preview/");
  document.body.appendChild(iframe);
}

setup().catch((e) => {
  status.textContent = "setup failed";
  log(String(e?.stack || e));
});
