import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Tweet interceptor build.
 *
 * This script runs in the PAGE world (injected via a <script> tag by the
 * content script). It must be a fully self-contained IIFE — no imports,
 * no globals beyond what the page already provides.
 *
 * Produces:
 *   dist/content/tweetInterceptor.js
 */
export default defineConfig({
  build: {
    outDir: "dist/content",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/content/tweetInterceptor.ts"),
      formats: ["iife"],
      name: "ByHumanInterceptor",
      fileName: () => "tweetInterceptor.js",
    },
    rollupOptions: {
      external: [],
    },
  },
});
