import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { standaloneServerSource } from "./templates.js";

const fixtures: Array<{ child: ChildProcessWithoutNullStreams; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>; directory: string }> = [];
const adapterSource = `import { appendFileSync } from "node:fs";
const mark = (name) => appendFileSync(process.env.BRIDGE_EVENTS, name + "\\n");
globalThis.__srvxLoader__({ server: {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/error") throw new Error("private database password");
    if (path === "/sse") {
      request.signal.addEventListener("abort", () => mark("aborted"), { once: true });
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("data: first\\n\\n")); },
        cancel() { mark("cancelled"); }
      }), { headers: { "content-type": "text/event-stream" } });
    }
    if (path === "/cookies") {
      const headers = new Headers();
      headers.append("set-cookie", "first=one; HttpOnly");
      headers.append("set-cookie", "second=two; HttpOnly");
      return new Response("cookies", { headers });
    }
    if (path === "/echo") { mark("echo"); return new Response(String((await request.arrayBuffer()).byteLength)); }
    return new Response("ok");
  },
  async close() { mark("closed"); if (process.env.BRIDGE_HANG_CLOSE === "true") await new Promise(() => {}); }
} });
`;

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    if (fixture.child.exitCode === null && fixture.child.signalCode === null) fixture.child.kill("SIGKILL");
    await fixture.exited;
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function launch(kind: "cli" | "crm", env: Record<string, string> = {}, ready = true) {
  const directory = await mkdtemp(join(tmpdir(), "framekit-bridge-"));
  await mkdir(join(directory, ".output/server"), { recursive: true });
  await writeFile(join(directory, ".output/server/index.mjs"), adapterSource);
  const source = kind === "cli" ? standaloneServerSource : await readFile(new URL("../../../examples/crm/test/serve-built-server.mjs", import.meta.url), "utf8");
  const entry = kind === "cli" ? join(directory, "start.mjs") : join(directory, "test/serve-built-server.mjs");
  if (kind === "crm") await mkdir(join(directory, "test"));
  await writeFile(entry, source);
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", FRAMEKIT_MAX_REQUEST_BYTES: "1024", FRAMEKIT_SHUTDOWN_TIMEOUT_MS: "500", BRIDGE_EVENTS: join(directory, "events"), ...env },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const exited = once(child, "exit").then(([code, signal]) => ({ code: code as number | null, signal: signal as NodeJS.Signals | null }));
  fixtures.push({ child, exited, directory });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const events = () => readFile(join(directory, "events"), "utf8").catch(() => "");
  let origin = "";
  if (ready) await eventually(() => {
    if (child.exitCode !== null) throw new Error("Bridge exited: " + stderr);
    origin = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? "";
    return Boolean(origin);
  });
  return { child, exited, origin, events, stderr: () => stderr };
}

async function eventually(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Bridge condition did not complete within two seconds.");
}

function chunkedPost(origin: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(origin + "/echo", { method: "POST" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode!, body }));
    });
    request.on("error", reject);
    request.write(Buffer.alloc(800));
    request.end(Buffer.alloc(800));
  });
}

describe.each(["cli", "crm"] as const)("%s Node response bridge", (kind) => {
  it("streams SSE immediately and propagates client disconnect to the adapter and source", async () => {
    const server = await launch(kind);
    const abort = new AbortController();
    const response = await fetch(server.origin + "/sse", { signal: abort.signal });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
    await reader.cancel();
    abort.abort();
    await eventually(async () => (await server.events()).includes("aborted") && (await server.events()).includes("cancelled"));
    expect(await (await fetch(server.origin)).text()).toBe("ok");
  });

  it("bounds both content-length and chunked bodies before the adapter, preserving smaller requests", async () => {
    const server = await launch(kind);
    const small = await fetch(server.origin + "/echo", { method: "POST", body: "x".repeat(1024) });
    expect(await small.text()).toBe("1024");
    const large = await fetch(server.origin + "/echo", { method: "POST", body: "x".repeat(2048) });
    expect(large.status).toBe(413);
    expect(await large.text()).toBe("Request body too large.");
    expect(await chunkedPost(server.origin)).toEqual({ status: 413, body: "Request body too large." });
    expect((await server.events()).split("\n").filter((event) => event === "echo")).toHaveLength(1);
  });

  it("preserves separate cookies and returns generic errors without exposing exception messages", async () => {
    const server = await launch(kind);
    const cookies = await fetch(server.origin + "/cookies");
    expect(cookies.headers.getSetCookie()).toEqual(["first=one; HttpOnly", "second=two; HttpOnly"]);
    await cookies.text();
    const failed = await fetch(server.origin + "/error");
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe("Internal server error.");
  });

  it("terminates active SSE and closes adapter resources during shutdown", async () => {
    const server = await launch(kind);
    const response = await fetch(server.origin + "/sse");
    const reader = response.body!.getReader();
    await reader.read();
    // The connection is deliberately open while SIGTERM starts shutdown.
    const finished = reader.read().catch(() => undefined);
    server.child.kill("SIGTERM");
    expect(await server.exited).toEqual({ code: 0, signal: null });
    await finished;
    const events = await server.events();
    expect(events).toContain("aborted");
    expect(events.split("\n").filter((event) => event === "closed")).toHaveLength(1);
  });

  it("bounds shutdown even if adapter cleanup hangs", async () => {
    const server = await launch(kind, { BRIDGE_HANG_CLOSE: "true", FRAMEKIT_SHUTDOWN_TIMEOUT_MS: "100" });
    server.child.kill("SIGTERM");
    expect(await server.exited).toEqual({ code: 1, signal: null });
    expect(await server.events()).toContain("closed");
  });

  it.each(["0", "-1", "NaN", "1.5", "9007199254740992"])("rejects invalid request byte limit %s before startup", async (value) => {
    const server = await launch(kind, { FRAMEKIT_MAX_REQUEST_BYTES: value }, false);
    expect((await server.exited).code).not.toBe(0);
    expect(server.stderr()).toContain("FRAMEKIT_MAX_REQUEST_BYTES must be a positive safe integer");
    expect(await server.events()).toBe("");
  });
});
