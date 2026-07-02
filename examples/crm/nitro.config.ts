import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
  compatibilityDate: "2026-07-02",
  preset: process.env.NITRO_PRESET,
  serverDir: "."
});
