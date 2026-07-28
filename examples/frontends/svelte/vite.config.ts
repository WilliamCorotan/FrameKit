import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const proxyTarget = loadEnv(mode, ".", "").FRAMEKIT_PROXY_TARGET || "http://localhost:3000";
  return {
    plugins: [svelte()],
    resolve: {
      conditions: ["development", "browser", "module"]
    },
    server: {
      proxy: {
        "/api": { target: proxyTarget, changeOrigin: true },
        "/health": { target: proxyTarget, changeOrigin: true }
      }
    }
  };
});
