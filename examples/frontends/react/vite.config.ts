import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const proxyTarget = loadEnv(mode, ".", "").FRAMEKIT_PROXY_TARGET || "http://localhost:3000";
  return {
    plugins: [react()],
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
