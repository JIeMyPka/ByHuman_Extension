import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Gmail content script build.
 *
 * Produces:
 *   dist/content/gmailContent.js  — single self-contained IIFE
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
      entry: resolve(__dirname, "src/content/gmailContent.ts"),
      formats: ["iife"],
      name: "ByHumanGmail",
      fileName: () => "gmailContent.js",
    },
    rollupOptions: {
      external: [],
    },
  },
});
