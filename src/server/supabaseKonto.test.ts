import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { skapaKontoDatabasFranKlient } from "./supabaseKonto";

/** Minimal stand-in for the RPC surface — checks names and parameter
 *  mapping only; the semantics are tested on the fake and live in SQL. */
function rpcKlient(svar: Record<string, { data: unknown; error: { message: string } | null }>) {
  const anrop: Array<{ namn: string; args: unknown }> = [];
  const sb = {
    rpc(namn: string, args: unknown) {
      anrop.push({ namn, args });
      return Promise.resolve(svar[namn] ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { sb, anrop };
}

describe("supabaseKonto (adapter)", () => {
  it("mappar RPC-namn och parametrar", async () => {
    const { sb, anrop } = rpcKlient({
      sakerstall_principal: { data: "p-1", error: null },
      ta_kvot: { data: true, error: null },
      radera_principal: {
        data: { principaler: 1, analyser: 2, behorigheter: 0, kvotrader: 3 },
        error: null,
      },
    });
    const db = skapaKontoDatabasFranKlient(sb);

    expect(await db.sakerstallPrincipal("e")).toBe("p-1");
    expect(await db.taKvot("k", 86400, 5)).toBe(true);
    await db.aterlamnaKvot("k", 86400);
    await db.slaSammanPrincipal("a", "b");
    expect(await db.raderaPrincipal("p-1")).toEqual({
      principaler: 1,
      analyser: 2,
      behorigheter: 0,
      kvotrader: 3,
    });

    expect(anrop).toEqual([
      { namn: "sakerstall_principal", args: { p_enhet_id: "e" } },
      { namn: "ta_kvot", args: { p_nyckel: "k", p_fonster_sek: 86400, p_max: 5 } },
      { namn: "aterlamna_kvot", args: { p_nyckel: "k", p_fonster_sek: 86400 } },
      { namn: "sla_samman_principal", args: { p_fran: "a", p_till: "b" } },
      { namn: "radera_principal", args: { p_id: "p-1" } },
    ]);
  });

  it("ta_kvot som inte svarar exakt true räknas som nekad", async () => {
    const { sb } = rpcKlient({ ta_kvot: { data: null, error: null } });
    expect(await skapaKontoDatabasFranKlient(sb).taKvot("k", 60, 1)).toBe(false);
  });

  it("RPC-fel blir synliga fel", async () => {
    const { sb } = rpcKlient({ ta_kvot: { data: null, error: { message: "boom" } } });
    await expect(skapaKontoDatabasFranKlient(sb).taKvot("k", 60, 1)).rejects.toThrow(/boom/);
  });

  it("exportera vägrar ett id som inte är uuid (det interpoleras i ett or-filter)", async () => {
    const { sb } = rpcKlient({});
    await expect(
      skapaKontoDatabasFranKlient(sb).exporteraPrincipal("x,sammanslagen_till.is.null"),
    ).rejects.toThrow(/uuid/);
  });
});
