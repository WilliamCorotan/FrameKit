import { writeFile } from "node:fs/promises";

globalThis.__srvxLoader__?.({
  server: {
    fetch: () => Response.json({ ok: false, app: "Fixture" }),
    close: async () => {
      await writeFile(process.env.FRAMEKIT_SMOKE_CLOSE_MARKER, "closed");
    }
  }
});
