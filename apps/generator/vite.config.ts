import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  server: { strictPort: true },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/maplibre-gl")) return "maplibre";
          if (id.includes("node_modules/@lucide/svelte") || id.includes("node_modules/svelte")) return "ui";
          return undefined;
        },
      },
    },
  },
});
