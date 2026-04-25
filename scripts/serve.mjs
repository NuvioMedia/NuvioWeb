import http from "node:http";
import os from "node:os";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8"
};

function getContentType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function getLanUrls() {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      urls.push(`http://${entry.address}:${port}/`);
    }
  }
  return Array.from(new Set(urls)).sort();
}

function resolveRequestPath(urlPathname) {
  let pathname = decodeURIComponent(String(urlPathname || "/"));
  if (pathname === "/") {
    pathname = "/index.html";
  }
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  return path.join(rootDir, normalized);
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    let filePath = resolveRequestPath(requestUrl.pathname);
    let fileStat = await stat(filePath).catch(() => null);

    if (fileStat?.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      fileStat = await stat(filePath).catch(() => null);
    }

    if (!fileStat?.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const fileContents = await readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": getContentType(filePath)
    });
    response.end(fileContents);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Server error: ${error?.message || error}`);
  }
});

server.listen(port, host, () => {
  const localHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`Serving Nuvio TV from ${rootDir}`);
  console.log(`Local URL: http://${localHost}:${port}/`);
  for (const lanUrl of getLanUrls()) {
    console.log(`LAN URL: ${lanUrl}`);
  }
  console.log("Use one of the URLs above if you want to test the app over http(s) during development.");
});
