import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const proxyTarget = loadEnv(mode, ".", "").FRAMEKIT_PROXY_TARGET || "http://localhost:3000";
  return {
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
