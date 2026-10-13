import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

// session.ts importerar serverfunktionen; i testet behövs bara cache-hjälparna.
vi.mock("@/server/analysFn", () => ({ hamtaSessionFn: vi.fn() }));

import { SESSION_KEY, SPARAT_KEY, sattInloggad, sattUtloggad } from "@/lib/session";

describe("session-cache", () => {
  it("sattInloggad lägger in sessionen och ogiltigförklarar sparade objekt", () => {
    const qc = new QueryClient();
    qc.setQueryData(SPARAT_KEY, { ok: true });
    sattInloggad(qc, "a@b.se", "p-1");
    expect(qc.getQueryData(SESSION_KEY)).toEqual({
      inloggad: true,
      epost: "a@b.se",
      principalId: "p-1",
    });
    expect(qc.getQueryState(SPARAT_KEY)?.isInvalidated).toBe(true);
  });

  it("sattUtloggad rensar sparade objekt så att nästa konto inte ser dem", () => {
    const qc = new QueryClient();
    sattInloggad(qc, "a@b.se", "p-1");
    qc.setQueryData(SPARAT_KEY, { ok: true, analyser: [] });
    sattUtloggad(qc);
    expect(qc.getQueryData(SESSION_KEY)).toEqual({ inloggad: false });
    expect(qc.getQueryData(SPARAT_KEY)).toBeUndefined();
  });
});
