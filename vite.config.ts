import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@core": resolve(__dirname, "../src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: { popup: resolve(__dirname, "src/popup/entry.tsx") },
      output: {
        entryFileNames: "[name].js",     // → dist/popup.js
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "[name][extname]", // → dist/popup.css
      },
    },
  },
});