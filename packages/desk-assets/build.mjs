import { cp, rm } from "node:fs/promises";
const assets = new URL("./assets/", import.meta.url);
await rm(assets, { recursive: true, force: true });
await cp(new URL("../../apps/desk/dist/", import.meta.url), assets, { recursive: true });
