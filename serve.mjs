import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "./worker/headers.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv[2] || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Use a port number between 1 and 65535.");
  process.exit(1);
}
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
};
const server = http.createServer(async (req, res) => {
  // The live Worker's security headers (worker/headers.mjs), so the preview runs under the same CSP. Plain http, so no HSTS.
  const secure = (pathname, contentType) => {
    for (const [name, value] of Object.entries(securityHeaders({ https: false, pathname, contentType })))
      res.setHeader(name, value);
  };
  secure();
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    // Like Cloudflare's assets, /name serves name.html.
    const file = path.resolve(
      root,
      "." +
        (pathname === "/"
          ? "/index.html"
          : path.extname(pathname)
            ? pathname
            : `${pathname}.html`),
    );
    const relative = path.relative(root, file);
    const contentType = types[path.extname(file)];
    if (
      !contentType ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      res.writeHead(404).end("Not found");
      return;
    }
    const { size } = await stat(file);
    secure(pathname, contentType);
    const headers = {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
    };
    // Streamed, with byte ranges, so the launch video can start and seek
    // without the whole file loading first.
    let start = 0,
      end = size - 1,
      status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    headers["Content-Length"] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD" || size === 0) {
      res.end();
      return;
    }
    createReadStream(file, { start, end })
      .on("error", () => res.destroy())
      .pipe(res);
  } catch {
    res.writeHead(404).end("Not found");
  }
});
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is in use. Try: node serve.mjs ${port + 1}`
      : error.message,
  );
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Orchy landing page: http://127.0.0.1:${port}\nPress Ctrl+C to stop.`,
  ),
);
