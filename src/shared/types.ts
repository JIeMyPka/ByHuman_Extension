/**
 * Shape of /api/extension/me responses.
 *
 * Kept in sync with src/app/api/extension/me/route.ts in the main project.
 * If you change one side, change the other.
 */
export interface MeUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export type MeResponse =
  | { authenticated: true; user: MeUser }
  | { authenticated: false; user: null };

/**
 * Auth state visible to popup UI.
 *
 * `unknown` is the initial render state before the first fetch resolves.
 * `error` carries a human-friendly message; we never surface raw fetch errors.
 */
export type AuthState =
  | { status: "unknown" }
  | { status: "checking" }
  | { status: "authenticated"; user: MeUser }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };
