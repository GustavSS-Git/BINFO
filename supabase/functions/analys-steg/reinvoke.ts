/**
 * Pure, Deno-independent half of the Edge Function's self-reinvoke (see
 * `reinvoke` in `index.ts`), split out like `effort.ts` so it can be
 * unit-tested under Vitest.
 *
 * VERIFIED (local Supabase stack, 2026-10-10): inside the Edge runtime
 * `req.url` is the INTERNAL address of the function
 * (`http://kong:8081/analys-steg` — internal port, no `/functions/v1`), so a
 * POST to it is refused and the next stage waits for the next minute tick (a
 * text job took 176 s instead of 106 s). The function must call itself through
 * the public API gateway: `<PROJECT_URL>/functions/v1/analys-steg`, with the
 * same `apikey` header pg_cron uses. `PROJECT_URL` is what the function already
 * reads for its Supabase client (locally `http://kong:8000`, which is
 * reachable from inside the runtime; the host-side 127.0.0.1:54321 is not).
 */

export const FUNKTIONSSOKVAG = "/functions/v1/analys-steg";

/** `<PROJECT_URL>/functions/v1/analys-steg`, trailing-slash safe. */
export function byggReinvokeUrl(projectUrl: string): string {
  const bas = projectUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/.test(bas)) {
    throw new Error(`PROJECT_URL måste vara en http(s)-URL för reinvoke, fick "${projectUrl}".`);
  }
  return bas + FUNKTIONSSOKVAG;
}
