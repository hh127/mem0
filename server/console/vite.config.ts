import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

/**
 * Dev proxies `/api/*` to the API (or the mock server) so the browser only ever
 * talks to its own origin. Production repeats the same contract in nginx, which
 * keeps the refresh cookie first-party and makes CORS a non-issue.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_DEV_API_TARGET || "http://127.0.0.1:9200";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 3001,
      strictPort: true,
      proxy: {
        // Trailing slash is deliberate: the SPA route /api-keys must not be proxied.
        "/api/": {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
    preview: { port: 3001, strictPort: true },
    build: { sourcemap: false },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
