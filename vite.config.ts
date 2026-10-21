import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = env.SERVER_PORT || "8787";

  return {
    root: "src/web",
    publicDir: "public",
    // three.js alone is ~500 kB; the page is served from localhost, so that's fine.
    build: { outDir: "../../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
    server: {
      port: 5173,
      proxy: { "/ws": { target: `ws://127.0.0.1:${backendPort}`, ws: true } },
    },
  };
});
