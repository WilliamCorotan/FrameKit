import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const smokeScript = join(root, "test/smoke-built-server.mjs");

test("the built-server smoke terminates successfully", { timeout: 10_000 }, async () => {
  const result = await run(process.execPath, [smokeScript], 8_000);

  assert.equal(result.timedOut, false, `smoke did not terminate\n${result.stderr}`);
  assert.equal(result.code, 0, `smoke exited with ${result.code}\n${result.stderr}`);
  assert.match(result.stdout, /"ok":true/);
});

test("a failed smoke closes the server adapter and exits non-zero", { timeout: 10_000 }, async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "framekit-smoke-"));
  const closeMarker = join(temporaryDirectory, "closed");

  try {
    const result = await run(process.execPath, [smokeScript], 8_000, {
      FRAMEKIT_SMOKE_CLOSE_MARKER: closeMarker,
      FRAMEKIT_SMOKE_SERVER_ENTRY: join(root, "test/fixtures/failing-built-server.mjs")
    });

    assert.equal(result.timedOut, false, `failed smoke did not terminate\n${result.stderr}`);
    assert.notEqual(result.code, 0, "failed smoke unexpectedly exited zero");
    assert.equal(existsSync(closeMarker), true, "server adapter was not closed");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function run(command, args, timeout, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr, stdout, timedOut });
    });
  });
}
