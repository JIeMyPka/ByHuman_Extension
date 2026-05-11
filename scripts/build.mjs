// @ts-check
/**
 * Extension build orchestrator.
 *
 * Two separate Vite passes:
 *   1. popup        — HTML entry, ESM output via vite.config.ts
 *   2. content      — single IIFE bundle via vite.content.config.ts
 *
 * Then copies static assets (manifest.json, icons/) into dist/.
 *
 * Usage:
 *   node scripts/build.mjs           # one-shot production build
 *   node scripts/build.mjs --watch   # dev: rebuild on change
 *
 * Cross-platform; no external deps beyond what Vite already provides.
 */

import { spawn } from "node:child_process";
import { rmSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const watch = process.argv.includes("--watch");

// Local installs put the vite binary in node_modules/.bin. Resolve it
// explicitly so `npm --prefix extension run build` works from the repo root.
const viteBin = resolve(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);

if (!existsSync(viteBin)) {
  console.error(
    `[build] vite binary not found at ${viteBin}.\n` +
      `Run \`npm install\` inside extension/ first.`,
  );
  process.exit(1);
}

// One-shot: clean dist before any build runs.
// In watch mode we still clean once at startup for a clean baseline.
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const args = (configPath) => {
  const out = ["build"];
  if (configPath) out.push("--config", configPath);
  if (watch) out.push("--watch");
  return out;
};

const isWindows = process.platform === "win32";

const runVite = (label, configPath) =>
    new Promise((resolveDone, rejectDone) => {
      const command = isWindows ? `"${viteBin}"` : viteBin;
      const child = spawn(command, args(configPath), {
        cwd: root,
        stdio: "inherit",
        env: process.env,
        shell: isWindows,
      });
      child.on("error", rejectDone);
      child.on("exit", (code) => {
        if (code === 0 || (watch && code === null)) {
          resolveDone();
        } else {
          rejectDone(new Error(`[${label}] vite exited with code ${code}`));
        }
      });
    });

const copyStatic = () => {
  cpSync(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));
  cpSync(resolve(root, "popup.html"), resolve(dist, "popup.html"));
  if (existsSync(resolve(root, "icons"))) {
    cpSync(resolve(root, "icons"), resolve(dist, "icons"), { recursive: true });
  }
  console.log("[build] manifest.json + icons/ copied to dist/");
};

(async () => {
  try {
    if (watch) {
      copyStatic();
      console.log("[build] starting watch for popup + content + interceptor...");
      runVite("popup", undefined).catch((e) => console.error(e));
      runVite("content", "vite.content.config.ts").catch((e) =>
        console.error(e),
      );
      runVite("interceptor", "vite.interceptor.config.ts").catch((e) =>
        console.error(e),
      );
    } else {
      await runVite("popup", undefined);
      await runVite("content", "vite.content.config.ts");
      await runVite("interceptor", "vite.interceptor.config.ts");
      copyStatic();
      console.log("[build] done. Load extension/dist as unpacked in Chrome.");
    }
  } catch (err) {
    console.error("[build] failed:", err);
    process.exit(1);
  }
})();
