import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// Vite's own 5173 collides with just about every other JS dev server, so the
// generator claims a quieter default. TOPOSTACK_WEB_PORT overrides it, and the
// root `npm run dev` sets that variable when it has to move off the default.
const DEFAULT_WEB_PORT = 5273;
const requestedWebPort = Number(process.env.TOPOSTACK_WEB_PORT);
const webPort = Number.isInteger(requestedWebPort) && requestedWebPort > 0 && requestedWebPort <= 65_535 ? requestedWebPort : DEFAULT_WEB_PORT;

export default defineConfig({
  plugins: [sveltekit()],
  server: { port: webPort, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/maplibre-gl")) return "maplibre";
          if (id.includes("node_modules/@lucide/svelte") || id.includes("node_modules/svelte") || id.includes("node_modules/bits-ui")) return "ui";
          return undefined;
        },
      },
    },
  },
});
