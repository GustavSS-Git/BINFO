/**
 * Fake `KontextKallor` for tests: cookies written through `sattCookie` read
 * back (like the write-through production binding), every write is recorded.
 */

import type { CookieAlternativ, KontextKallor } from "../kontext";

export interface FakeKallor extends KontextKallor {
  cookies: Map<string, string>;
  satta: Array<{ namn: string; varde: string; alternativ: CookieAlternativ }>;
}

export function fakeKallor(
  headers: Record<string, string> = {},
  cookies: Record<string, string> = {},
): FakeKallor {
  const k: FakeKallor = {
    cookies: new Map(Object.entries(cookies)),
    satta: [],
    lasCookie(namn) {
      return this.cookies.get(namn);
    },
    sattCookie(namn, varde, alternativ) {
      this.satta.push({ namn, varde, alternativ });
      this.cookies.set(namn, varde);
    },
    lasHeader(namn) {
      return headers[namn.toLowerCase()];
    },
  };
  return k;
}
