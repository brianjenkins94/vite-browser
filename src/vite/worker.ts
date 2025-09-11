// src/vite/worker.ts

/**
 * Base and paths (fixed as requested)
 */
const BASE_PATH = "/vite-browser/";
const VITE_PATH = ensureDirectoryPath(joinPaths(BASE_PATH, "vite"));
const PREVIEW_ROOT_PATH = ensureDirectoryPath(joinPaths(VITE_PATH, "preview"));
const BROADCAST_CHANNEL_NAME = PREVIEW_ROOT_PATH + "bus";

/**
 * Path helpers
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
 * Messaging
 */
const broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

/**
 * In-memory virtual file system.
 * Keys are ABSOLUTE pathnames under PREVIEW_ROOT_PATH, for example:
 *   /vite-browser/vite/preview/index.html
 *   /vite-browser/vite/preview/app.js
 */
const virtualFileSystem = new Map<string, string>();

/**
 * Compile pipeline (very small and explicit).
 * For now, it merely:
 *  - serves HTML as text/html
 *  - serves JS as application/javascript
 *  - for ".ts" and ".tsx" performs a minimal, naive transform (NOT production-ready)
 */
function compileToResponse(absolutePathname: string): { ok: boolean; status: number; body?: string; headers?: Record<string, string> } {
  const body = virtualFileSystem.get(absolutePathname);
  if (body === undefined) {
    return { ok: false, status: 404 };
  }

  const contentType = detectContentType(absolutePathname);

  if (absolutePathname.endsWith(".ts") || absolutePathname.endsWith(".tsx")) {
    // Extremely naive transform: strip `: type` after identifiers,
    // remove `interface ... {}`, remove `type ... = ...;`, and remove `export type`.
    // This is only to make trivial TS examples run; replace with a real compiler later.
    const transformed = body
      // remove "export type" lines
      .replace(/^\s*export\s+type\s+[^\n]*\n/gm, "")
      // remove "type X = ..." lines
      .replace(/^\s*type\s+[^\n]*\n/gm, "")
      // remove "interface X { ... }" blocks (very naive)
      .replace(/^\s*interface\s+\w+\s*\{[\s\S]*?\}\s*$/gm, "")
      // remove simple ": Type" annotations (naive; will not handle all cases)
      .replace(/:\s*[^=;,)]+(?=[=;,)])/g, "")
      // remove "<T>" after function names (very naive)
      .replace(/function\s+(\w+)\s*<[^>]+>\s*\(/g, "function $1(")
      // remove "<T>" after const foo = <T>(...
      .replace(/=\s*<[^>]+>\s*\(/g, "=(");

    return {
      ok: true,
      status: 200,
      body: transformed,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    };
  }

  return {
    ok: true,
    status: 200,
    body,
    headers: { "Content-Type": contentType },
  };
}

function detectContentType(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".js") || pathname.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  return "text/plain; charset=utf-8";
}

/**
 * Handle messages from the page and the service worker
 */
broadcastChannel.addEventListener("message", (event: MessageEvent) => {
  const message = event.data;

  if (message !== undefined && message !== null && typeof message === "object") {
    // 1) Health checks
    if (message.type === "PING_WORKER") {
      broadcastChannel.postMessage({ type: "PONG_WORKER" });
      return;
    }

    // 2) File operations from the parent page
    if (message.type === "FILES_SET") {
      if (message.previewRootPath !== PREVIEW_ROOT_PATH) {
        // base/scope mismatch guard
        broadcastChannel.postMessage({ type: "FILES_APPLIED", ok: false, reason: "previewRootPath mismatch" });
        return;
      }
      const files = message.files as Record<string, string> | undefined;
      if (files !== undefined) {
        virtualFileSystem.clear();
        for (const [relativePath, content] of Object.entries(files)) {
          const absolutePath = joinPaths(PREVIEW_ROOT_PATH, relativePath);
          virtualFileSystem.set(absolutePath, String(content));
        }
      }
      broadcastChannel.postMessage({ type: "FILES_APPLIED", ok: true });
      return;
    }

    if (message.type === "FILES_PATCH") {
      if (message.previewRootPath !== PREVIEW_ROOT_PATH) {
        broadcastChannel.postMessage({ type: "FILES_APPLIED", ok: false, reason: "previewRootPath mismatch" });
        return;
      }
      const changes = message.changes as Array<{ path: string; content: string | null }> | undefined;
      if (changes !== undefined) {
        for (const change of changes) {
          const absolutePath = joinPaths(PREVIEW_ROOT_PATH, change.path);
          if (change.content === null) {
            virtualFileSystem.delete(absolutePath);
          } else {
            virtualFileSystem.set(absolutePath, String(change.content));
          }
        }
      }
      broadcastChannel.postMessage({ type: "FILES_APPLIED", ok: true });
      return;
    }

    if (message.type === "FILES_CLEAR") {
      virtualFileSystem.clear();
      broadcastChannel.postMessage({ type: "FILES_APPLIED", ok: true });
      return;
    }

    // 3) Compile requests from the Service Worker
    if (message.type === "COMPILE_REQUEST") {
      const id = message.id as string | undefined;
      const urlPathname = message.url as string | undefined;

      if (id !== undefined && urlPathname !== undefined) {
        // normalize "/preview/" → "/preview/index.html"
        const normalized =
          urlPathname.endsWith("/preview/") ? joinPaths(urlPathname, "index.html") : urlPathname;

        const result = compileToResponse(normalized);
        if (result.ok === true && result.body !== undefined && result.headers !== undefined) {
          broadcastChannel.postMessage({
            type: "COMPILE_RESPONSE",
            id,
            ok: true,
            status: result.status,
            body: result.body,
            headers: result.headers,
          });
        } else {
          broadcastChannel.postMessage({
            type: "COMPILE_RESPONSE",
            id,
            ok: false,
            status: result.status,
          });
        }
      }
      return;
    }
  }
});

// Announce readiness after listeners are attached
broadcastChannel.postMessage({ type: "WORKER_READY" });
