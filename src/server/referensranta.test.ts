import { describe, expect, it, vi } from "vitest";
import { REFERENSRANTA_RESERV, REFERENSRANTA_SERIE } from "@/lib/analysis/calc/prognosantaganden";
import { skapaFakeKontoDatabas } from "./__fakes__/konto";
import { hamtaFranRiksbanken, hamtaReferensranta, stockholmsDatum } from "./referensranta";

const svarMed = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("referensranta", () => {
  it("stockholmsDatum uses Stockholm time (23:30 UTC on 24 Oct is 25 Oct in Stockholm)", () => {
    expect(stockholmsDatum(new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
  });

  it("fetches the latest SETB3MBENCH observation and caches it", async () => {
    const nu = new Date("2026-10-24T10:00:00Z");
    const db = skapaFakeKontoDatabas({ nu: () => nu });
    const fetchFn = svarMed({ date: "2026-10-23", value: 2.068 });
    const r = await hamtaReferensranta(db, { fetchFn, nu });
    expect(r).toMatchObject({ procent: 2.068, datum: "2026-10-23", reserv: false });
    expect(r.serie).toBe(REFERENSRANTA_SERIE);
    expect(String((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain(
      "/Observations/Latest/SETB3MBENCH",
    );
    expect(db.referensrantor.get(REFERENSRANTA_SERIE)?.procent).toBe(2.068);
  });

  it("a value fetched the same Stockholm day is served without a request", async () => {
    const nu = new Date("2026-10-24T10:00:00Z");
    const db = skapaFakeKontoDatabas({ nu: () => nu });
    await db.skrivReferensranta(REFERENSRANTA_SERIE, { datum: "2026-10-23", procent: 2.1 });
    const fetchFn = svarMed({ date: "2026-10-24", value: 9 });
    const r = await hamtaReferensranta(db, { fetchFn, nu: new Date("2026-10-24T15:00:00Z") });
    expect(r.procent).toBe(2.1);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refetches on a new day; a failed fetch falls back to the stale cached value", async () => {
    const igar = new Date("2026-10-23T10:00:00Z");
    const db = skapaFakeKontoDatabas({ nu: () => igar });
    await db.skrivReferensranta(REFERENSRANTA_SERIE, { datum: "2026-10-22", procent: 2.0 });
    const r = await hamtaReferensranta(db, {
      fetchFn: svarMed({ error: "x" }, 503),
      nu: new Date("2026-10-24T10:00:00Z"),
    });
    expect(r).toMatchObject({ procent: 2.0, datum: "2026-10-22", reserv: false });
  });

  it("no cache and no answer → the configured fallback, labelled reserv", async () => {
    const r = await hamtaReferensranta(null, { fetchFn: svarMed({ date: "bad", value: 1 }) });
    expect(r).toMatchObject({
      procent: REFERENSRANTA_RESERV.procent,
      datum: REFERENSRANTA_RESERV.datum,
      reserv: true,
    });
  });

  it("rejects implausible values and network errors without throwing", async () => {
    expect(await hamtaFranRiksbanken(svarMed({ date: "2026-10-23", value: 99 }))).toBeNull();
    const kastar = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    expect(await hamtaFranRiksbanken(kastar)).toBeNull();
  });

  it("a cache read error does not break the read", async () => {
    const trasig = {
      lasReferensranta: async () => {
        throw new Error("db nere");
      },
      skrivReferensranta: async () => {
        throw new Error("db nere");
      },
    };
    const r = await hamtaReferensranta(trasig, {
      fetchFn: svarMed({ date: "2026-10-23", value: 2.068 }),
    });
    expect(r.procent).toBe(2.068);
  });
});
