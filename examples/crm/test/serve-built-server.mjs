import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const entry = new URL("../.output/server/index.mjs", import.meta.url);
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 45123);
const maxRequestBytes = positiveInteger("FRAMEKIT_MAX_REQUEST_BYTES", 16 * 1024 * 1024);
const shutdownTimeoutMs = positiveInteger("FRAMEKIT_SHUTDOWN_TIMEOUT_MS", 5000, 60_000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer from 0 to 65535.");
if (!existsSync(entry)) throw new Error("Build the app before starting it.");

let adapter;
globalThis.__srvxLoader__ = ({ server }) => { adapter = server; };
try { await import(entry.href); } finally { delete globalThis.__srvxLoader__; }
if (!adapter?.fetch) throw new Error("Built Nitro adapter did not initialize.");

const activeRequests = new Set();
const server = createServer(async (incoming, outgoing) => {
  const cancellation = new AbortController();
  activeRequests.add(cancellation);
  const abort = () => cancellation.abort();
  const disconnected = () => { if (!outgoing.writableFinished) abort(); };
  incoming.once("aborted", abort);
  outgoing.once("close", disconnected);
  try {
    if (Number(incoming.headers["content-length"]) > maxRequestBytes) {
      rejectLargeRequest(incoming, outgoing);
      return;
    }
    const chunks = [];
    let size = 0;
    // Keep the socket writable when leaving the iterator to send a 413 response.
    for await (const chunk of incoming.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > maxRequestBytes) {
        rejectLargeRequest(incoming, outgoing);
        return;
      }
      chunks.push(chunk);
    }
    cancellation.signal.throwIfAborted();
    const method = incoming.method ?? "GET";
    const response = await adapter.fetch(new Request(new URL(incoming.url ?? "/", "http://" + (incoming.headers.host ?? host)), {
      method,
      headers: incoming.headers,
      body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks, size),
      signal: cancellation.signal
    }));
    outgoing.statusCode = response.status;
    for (const [name, value] of response.headers) if (name !== "set-cookie") outgoing.setHeader(name, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader("set-cookie", cookies);
    if (!response.body || method === "HEAD") {
      await response.body?.cancel();
      outgoing.end();
    } else {
      outgoing.flushHeaders();
      await pipeline(Readable.fromWeb(response.body), outgoing, { signal: cancellation.signal });
    }
  } catch {
    if (outgoing.destroyed) return;
    if (cancellation.signal.aborted || outgoing.headersSent) outgoing.destroy();
    else {
      for (const header of outgoing.getHeaderNames()) outgoing.removeHeader(header);
      outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      outgoing.end("Internal server error.");
    }
  } finally {
    incoming.off("aborted", abort);
    outgoing.off("close", disconnected);
    activeRequests.delete(cancellation);
  }
});

let closePromise;
function close() {
  return closePromise ??= (async () => {
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, shutdownTimeoutMs);
    try {
      const stopped = new Promise((resolve) => server.close(resolve));
      for (const cancellation of activeRequests) cancellation.abort();
      server.closeIdleConnections();
      await Promise.all([stopped, Promise.resolve().then(() => adapter.close?.(true))]);
    } finally { clearTimeout(deadline); }
  })();
}

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolve(); });
  });
} catch (error) {
  await close();
  throw error;
}
console.log("Framekit listening on http://" + host + ":" + server.address().port);
process.once("SIGINT", () => void close().then(() => process.exit(0), () => process.exit(1)));
process.once("SIGTERM", () => void close().then(() => process.exit(0), () => process.exit(1)));

function rejectLargeRequest(incoming, outgoing) {
  outgoing.writeHead(413, { "connection": "close", "content-type": "text/plain; charset=utf-8" });
  outgoing.once("finish", () => incoming.destroy());
  outgoing.end("Request body too large.");
  incoming.resume();
}

function positiveInteger(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(name + " must be a positive safe integer at most " + maximum + ".");
  return value;
}
