import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 3000,
    strictPort: true,
    host: host || "0.0.0.0",
    allowedHosts: true,
    hmr: undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
