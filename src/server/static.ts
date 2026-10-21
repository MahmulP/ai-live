import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".obj": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

/**
 * Serves the built avatar page in production. With `root` null (dev mode),
 * Vite serves the page instead and this only points the user there.
 */
export function createStaticHandler(root: string | null, devUrl: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!root) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Backend jalan. Halaman avatar ada di ${devUrl}`);
      return;
    }
    let rel = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(root, `.${rel}`);
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  };
}
