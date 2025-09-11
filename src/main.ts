// src/main.ts
import { Workbox } from "workbox-window";

/**
 * Constants
 */
const BASE_PATH = "/vite-browser/"; // as requested, assume fixed base
const VITE_PATH = ensureDirectoryPath(joinPaths(BASE_PATH, "vite"));
const PREVIEW_ROOT_PATH = ensureDirectoryPath(joinPaths(VITE_PATH, "preview"));
const BROADCAST_CHANNEL_NAME = PREVIEW_ROOT_PATH + "bus";

const SERVICE_WORKER_URL = joinPaths(VITE_PATH, "sw.js");
const BUNDLER_WORKER_URL = joinPaths(VITE_PATH, "worker.js");
const PREVIEW_URL = PREVIEW_ROOT_PATH; // navigating to this will serve index.html

/**
 * Small path helpers (directory keeps trailing slash; files do not)
 */
function ensureDirectoryPath(input: string): string {
  const normalized = ("/" + input).replace(/\/+/g, "/");
  return normalized.endsWith("/") ? normalized : normalized + "/";
}
function joinPaths(...segments: string[]): string {
  return (
    "/" +
    segments
      .map((s) => String(s).replace(/^\/+|\/+$/g, ""))
      .filter((s) => s.length > 0)
      .join("/")
  ).replace(/\/+/g, "/");
}

/**
 * Basic log panel so you can see the sequence in the page
 */
const statusElement = ensureElement("p", "status", "booting…");
const logElement = ensureElement("pre", "log", "");
function ensureElement<T extends HTMLElement>(
  tag: string,
  id: string,
  text: string
): T {
  const existing = document.getElementById(id) as T | null;
  if (existing !== null) return existing;
  const el = document.createElement(tag) as T;
  el.id = id;
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}
function log(line: string): void {
  logElement.textContent = (logElement.textContent || "") + line + "\n";
}

/**
 * Messaging channel shared by page, worker, and SW
 */
const broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

/**
 * Public API (you can call these from your editor UI)
 */
async function setProjectFiles(filesByRelativePath: Record<string, string>): Promise<void> {
  const acknowledgment = waitForOnce("FILES_APPLIED");
  broadcastChannel.postMessage({
    type: "FILES_SET",
    previewRootPath: PREVIEW_ROOT_PATH,
    files: filesByRelativePath, // keys like "index.html", "app.js", "src/main.ts" if you want
  });
  await acknowledgment;
}

async function patchProjectFiles(
  changes: Array<{ path: string; content: string | null }>
): Promise<void> {
  const acknowledgment = waitForOnce("FILES_APPLIED");
  broadcastChannel.postMessage({
    type: "FILES_PATCH",
    previewRootPath: PREVIEW_ROOT_PATH,
    changes, // path is relative to preview root (e.g., "app.js"); content null means delete
  });
  await acknowledgment;
}

/**
 * Boot sequence (sequential and explicit)
 */
(async function bootSequentially() {
  // 1) Open BroadcastChannel listeners *before* starting workers so we never miss READY messages
  broadcastChannel.addEventListener("message", (event: MessageEvent) => {
    const data = event.data;
    if (data !== undefined && typeof data === "object") {
      if (data.type === "WORKER_READY") log("[WORKER] READY");
      if (data.type === "WORKER_DEBUG") log("[WORKER] " + JSON.stringify(data));
      if (data.type === "PONG_WORKER") log("[WORKER] PONG");
    }
  });

  // 2) Start the bundler worker (module)
  const bundlerWorker = new Worker(BUNDLER_WORKER_URL, { type: "module" });

  // 3) Register the service worker (module) using Workbox Window
  const workbox = new Workbox(SERVICE_WORKER_URL, {
    scope: VITE_PATH,
    // Workbox Window accepts additional options; type is not typed here,
    // but modern browsers support module service workers:
    // @ts-ignore
    type: "module",
  });

  workbox.addEventListener("waiting", () => workbox.messageSkipWaiting());
  workbox.addEventListener("controlling", () => window.location.reload());
  const registration = await workbox.register();

  // 4) Wait for this registration to be activated (the page itself is outside the SW scope)
  await waitForServiceWorkerActivation(registration);
  statusElement.textContent = "service worker registered";

  // 5) Wait for bundler worker readiness
  await waitForWorkerReady(broadcastChannel, 8000);

  // 6) Send initial project (minimal) — replace this with your editor’s files
  await setProjectFiles({
    "index.html": `<!doctype html>
<html><head><meta charset="utf-8"><title>Preview</title></head>
<body>
  <h1>Preview served by Service Worker + Bundler Worker</h1>
  <p id="from-app"></p>
  <script type="module" src="./app.js"></script>
</body></html>`,
    "app.js": `document.getElementById('from-app').textContent =
      'Hello from app.js @ ' + new Date().toISOString();`,
  });

  // 7) Create the preview iframe (under the SW scope)
  const iframe = document.createElement("iframe");
  iframe.style.width = "100%";
  iframe.style.height = "340px";
  iframe.src = PREVIEW_URL; // will resolve to index.html inside SW
  document.body.appendChild(iframe);

  // Optional: ping the SW so you can see host<->SW messages
  if (registration.active !== null) {
    registration.active.postMessage({ type: "PING_FROM_PAGE", at: Date.now() });
  }
})().catch((error) => {
  statusElement.textContent = "boot failed";
  log(String((error && (error as any).stack) || error));
});

/**
 * Helpers (explicit conditions)
 */
function waitForServiceWorkerActivation(
  registration: ServiceWorkerRegistration
): Promise<void> {
  const candidate =
    registration.installing || registration.waiting || registration.active;
  if (candidate !== undefined && candidate !== null && candidate.state === "activated") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const sw = registration.installing || registration.waiting || registration.active;
    if (sw === undefined || sw === null) {
      resolve();
      return;
    }
    const onChange = () => {
      if (sw.state === "activated") {
        sw.removeEventListener("statechange", onChange);
        resolve();
      }
    };
    sw.addEventListener("statechange", onChange);
    onChange();
  });
}

function waitForWorkerReady(
  channel: BroadcastChannel,
  timeoutMilliseconds: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let isReady = false;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data !== undefined && data !== null && typeof data === "object") {
        if (data.type === "WORKER_READY" || data.type === "PONG_WORKER") {
          isReady = true;
          channel.removeEventListener("message", onMessage as any);
          resolve();
        }
      }
    };
    channel.addEventListener("message", onMessage as any);

    const startTime = Date.now();
    (function pingLoop() {
      if (isReady === true) return;
      if (Date.now() - startTime > timeoutMilliseconds) {
        channel.removeEventListener("message", onMessage as any);
        reject(new Error("Bundler worker did not become ready in time"));
        return;
      }
      channel.postMessage({ type: "PING_WORKER" });
      setTimeout(pingLoop, 200);
    })();
  });
}

function waitForOnce(expectedType: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data !== undefined && data !== null && typeof data === "object") {
        if (data.type === expectedType) {
          broadcastChannel.removeEventListener("message", onMessage as any);
          resolve();
        }
      }
    };
    broadcastChannel.addEventListener("message", onMessage as any);
  });
}

// Expose the public API (optional)
(Object.assign(window as any, { setProjectFiles, patchProjectFiles }));
