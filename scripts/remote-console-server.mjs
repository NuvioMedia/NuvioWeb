import http from "node:http";
import os from "node:os";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4174);

function getLanUrls() {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      urls.push(`http://${entry.address}:${port}/log`);
    }
  }
  return Array.from(new Set(urls)).sort();
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", () => resolve(body));
  });
}

function formatValue(value) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function printLog(payload = {}) {
  const level = String(payload.level || "log").toUpperCase().padEnd(5, " ");
  const timestamp = String(payload.timestamp || new Date().toISOString());
  const prefix = `[${timestamp}] ${level}`;
  const args = Array.isArray(payload.args) ? payload.args : [];
  const message = args.map(formatValue).join(" ");
  console.log(`${prefix} ${message}`);
}

const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Nuvio remote console is running.\n");
    return;
  }

  const body = await readBody(request);
  try {
    printLog(JSON.parse(body || "{}"));
  } catch (_) {
    console.log(body);
  }
  response.writeHead(204);
  response.end();
});

server.listen(port, host, () => {
  console.log(`Nuvio remote console listening on http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/log`);
  const lanUrls = getLanUrls();
  for (const url of lanUrls) {
    console.log(`LAN endpoint: ${url}`);
  }
  if (lanUrls[0]) {
    console.log("");
    console.log("Package with:");
    console.log(`NUVIO_DEBUG_LOG_ENDPOINT=${lanUrls[0]} npm run package:webos`);
  }
});
