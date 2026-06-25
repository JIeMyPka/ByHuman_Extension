import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Content script build.
 *
 * Chrome MV3 supports ESM in content scripts, but bundling everything into a
 * single self-contained IIFE is simpler and more robust against weird
 * extension-page contexts (no module resolution at runtime, no extra files).
 *
 * Produces:
 *   dist/content/twitterContent.js  — single self-contained content script
 */
export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@core": resolve(__dirname, "node_modules/@byhuman/provenance-core/src"),
    },
  },
  build: {
    outDir: "dist/content",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/content/twitterContent.ts"),
      formats: ["iife"],
      name: "ByHumanContent",
      fileName: () => "twitterContent.js",
    },
    rollupOptions: {
      // Content scripts must be fully self-contained. No externals.
      external: [],
    },
  },
});
