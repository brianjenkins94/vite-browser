// src/main.ts
const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("log")!;

const BASE = norm(import.meta.env.BASE_URL || "/"); // e.g. "/" or "/repo-name/"
const VITE_PREFIX = join(BASE, "vite/");            // "/vite/" or "/repo-name/vite/"
const CHANNEL_NAME = `${VITE_PREFIX}bus`;

function norm(p: string) {
  return (p.endsWith("/") ? p : p + "/").replace(/\/+/g, "/");
}
function join(a: string, b: string) {
  return norm(a.replace(/\/+$/, "/") + b.replace(/^\/+/, ""));
}
function log(s: string) {
  logEl.textContent += s + "\n";
}

const bc = new BroadcastChannel(CHANNEL_NAME);

(async function boot() {
  if (!("serviceWorker" in navigator)) {
    statusEl.textContent = "SW not supported";
    return;
  }

  // Start the bundler worker (module worker)
  const workerUrl = join(VITE_PREFIX, "worker.js");
  const bundlerWorker = new Worker(workerUrl, { type: "module" });

  // Register the SW under the same <base>/vite/ scope
  const swUrl = join(VITE_PREFIX, "sw.js");
  const reg = await navigator.serviceWorker.register(swUrl, {
    scope: VITE_PREFIX,
    // type: "module", // optional; modern browsers support module SWs
  });
  await navigator.serviceWorker.ready;
  statusEl.textContent = "service worker registered";

  // SW roundtrip
  navigator.serviceWorker.addEventListener("message", (evt) => {
    log("from SW: " + JSON.stringify(evt.data));
  });
  reg.active?.postMessage({ type: "PING_FROM_PAGE", at: Date.now() });

  // Observe worker status
  let workerReady = false;
  const onBC = (e: MessageEvent) => {
    if (e.data?.type === "WORKER_READY") {
      workerReady = true;
      log("worker: ready");
      bc.removeEventListener("message", onBC as any);
    }
  };
  bc.addEventListener("message", onBC as any);

  // Create the preview iframe that the SW will serve
  const iframe = document.createElement("iframe");
  iframe.style.width = "100%";
  iframe.style.height = "320px";
  iframe.src = join(VITE_PREFIX, "preview/");
  document.body.appendChild(iframe);
})().catch((e) => {
  statusEl.textContent = "boot failed";
  log(String(e?.stack || e));
});
