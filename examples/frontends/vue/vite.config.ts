import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const proxyTarget = loadEnv(mode, ".", "").FRAMEKIT_PROXY_TARGET || "http://localhost:3000";
  return {
    plugins: [vue()],
    resolve: {
      conditions: ["development", "browser", "module"],
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    server: {
      proxy: {
        "/api": { target: proxyTarget, changeOrigin: true },
        "/health": { target: proxyTarget, changeOrigin: true }
      }
    }
  };
});
