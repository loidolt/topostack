import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

/** @type {import("@sveltejs/kit").Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: "dist", assets: "dist", strict: true }),
    alias: {
      "@topostack/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
    paths: { relative: true },
  },
};

export default config;
