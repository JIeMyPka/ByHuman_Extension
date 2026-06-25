# ByHuman Chrome Extension

ByHuman Chrome Extension is an early Manifest V3 browser extension for capturing observable writing effort on supported publishing platforms.

It detects how text is entered into composers across supported platforms — typed vs pasted input, edits, deletions — and sends composition metadata to the ByHuman backend to generate verifiable writing receipts.

## Current version

```text
v0.1.0
Manifest V3
```

## Quick start: load the existing build

For the current repository version, you can use the already prepared `dist/` folder. You do not need to build the extension before testing it.

1. Open Chrome and go to:

```text
chrome://extensions
```

2. Enable **Developer mode** in the top-right corner.

3. Click **Load unpacked**.

4. Select the `dist/` folder from this repository.

5. The ByHuman extension should appear in the extensions list.

If the extension was already loaded and you changed files inside `dist/`, click **Reload** on the extension card in Chrome.

## What it does

- Detects composer activity on supported platforms
- Tracks typed vs pasted writing behavior per session
- Connects to the ByHuman backend API to generate signed receipts
- Includes a popup UI for extension status
- Works as an unpacked Chrome extension during development

## Supported websites

```text
https://x.com/*
https://twitter.com/*
https://mail.google.com/*
```

**X / Twitter** — intercepts the `CreateTweet` network call to auto-submit a receipt when a tweet is published. A floating indicator shows live typing/paste stats during composition.

**Gmail** — attaches to the compose window body. Submits a private receipt when the Send button is clicked. Supports multiple compose windows open simultaneously. Receipts default to `PRIVATE` visibility.

## Repository structure

The exact structure may change as the extension evolves, but the repository generally contains:

```text
.
├── dist/                       # Ready-to-load extension build
├── icons/                      # Extension icons
├── scripts/                    # Build scripts
├── src/
│   ├── content/                # Content scripts for supported websites
│   ├── popup/                  # Extension popup UI
│   └── shared/                 # Shared API helpers, config, and types
├── manifest.json               # Extension manifest source
├── popup.html                  # Popup HTML
├── package.json
├── tsconfig.json
└── vite config files
```

The `dist/` folder is the folder Chrome should load when using **Load unpacked**.

## Requirements for development

For simply loading the current extension build, you only need:

```text
Google Chrome or another Chromium-based browser
```

For development or rebuilding the extension, install:

```text
Node.js 18+
npm
```

## Install dependencies

Clone the repository:

```bash
git clone <REPOSITORY_URL>
cd <REPOSITORY_NAME>
```

Install dependencies:

```bash
npm install
```

You only need this step if you plan to modify source files and rebuild the extension. If you only want to test the current extension, load the existing `dist/` folder directly.

## Environment variables

If the project includes an `.env.example` file, create a local `.env` file:

```bash
cp .env.example .env
```

For local development, use:

```env
VITE_BYHUMAN_API_BASE_URL=http://localhost:3000
```

For production builds, use:

```env
VITE_BYHUMAN_API_BASE_URL=https://byhuman.ink
```

Important:

```text
Do not put secret keys in the extension.
Do not store backend secrets, Clerk secrets, API keys, or signing secrets here.
The extension only talks to the ByHuman backend.
```

## Optional: rebuild the extension

The current version can be loaded from `dist/` without rebuilding. Rebuild only if you changed the source code.

Build once:

```bash
npm run build
```

Run development/watch mode, if configured:

```bash
npm run dev
```

Check TypeScript errors, if configured:

```bash
npm run typecheck
```

After rebuilding, load or reload the generated `dist/` folder in Chrome.

## Local development with backend

For local testing, the ByHuman web app/backend should usually run at:

```text
http://localhost:3000
```

The extension communicates with the backend API. Typical endpoints may include:

```text
/api/extension/me
/api/posts
```

Typical local workflow:

```bash
# Terminal 1: run the ByHuman web/backend app
npm run dev

# Terminal 2: rebuild or watch the extension, if needed
npm run dev
```

Then open `chrome://extensions`, load the `dist/` folder, and test the extension on X/Twitter or Gmail.

## Production build

For production:

```bash
VITE_BYHUMAN_API_BASE_URL=https://byhuman.ink npm run build
```

On Windows PowerShell:

```powershell
$env:VITE_BYHUMAN_API_BASE_URL="https://byhuman.ink"
npm run build
```

Then use the generated `dist/` folder.

## Security notes

The extension should not contain private keys or secrets.

All sensitive logic, including authentication verification, receipt signing, and database writes, must happen on the ByHuman backend.

The extension only collects composition metadata required for generating writing receipts.

## Status

This is an early MVP extension.

Current focus:

- Gmail and X/Twitter composer tracking live
- Improve capture reliability across both platforms
- Improve login/session handling
- Prepare for user testing
- Add clearer receipt and verification states in the popup

## License

Private repository. All rights reserved.
