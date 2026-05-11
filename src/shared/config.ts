/**
 * Backend URL the extension talks to.
 *
 * Configurable at build time via VITE_BYHUMAN_API_BASE_URL.
 * Defaults to local dev so the unpacked extension works out of the box
 * against `npm run dev` on http://localhost:3000.
 *
 * For production builds, set the env var before building, e.g.
 *   VITE_BYHUMAN_API_BASE_URL=https://byhuman.ink npm run extension:build
 *
 * NEVER put secret keys in this file. The extension only talks to the
 * ByHuman backend; the backend is the only thing that talks to Clerk.
 */
export const API_BASE_URL: string =
    import.meta.env.VITE_BYHUMAN_API_BASE_URL || "https://byhuman.ink";

// Fallback — used automatically when API_BASE_URL is unreachable
export const API_FALLBACK_URL = "http://localhost:3000";

export const ME_URL: string = `${API_BASE_URL}/api/extension/me`;
export const FALLBACK_ME_URL: string = `${API_FALLBACK_URL}/api/extension/me`;
export const POSTS_URL: string = `${API_BASE_URL}/api/posts`;
export const SIGN_IN_URL: string = `${API_BASE_URL}/`;