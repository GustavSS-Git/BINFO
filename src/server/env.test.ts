import { describe, expect, it } from "vitest";
import { lasEnv, OgiltigMiljoError, OsakerMiljoNyckelError, type Env } from "./env";

function giltigRecord(): Record<string, string | undefined> {
  return {
    PROJECT_URL: "https://abcabcabc.supabase.co",
    PROJECT_SECRET_KEY: "sb_secret_xxx",
    PROJECT_PUBLISHABLE_KEY: "sb_publishable_xxx",
    MAX_DAILY_SPEND_SEK: "200",
    ANALYSIS_KILL_SWITCH: "off",
    ANTHROPIC_API_KEY: "sk-ant-xxx",
    ANTHROPIC_MODEL: "claude-sonnet-5",
    MAX_COST_PER_ANALYSIS_SEK: "5",
  };
}

describe("lasEnv", () => {
  it("parsar en fullständig, giltig record", () => {
    const env: Env = lasEnv(giltigRecord());

    expect(env.supabaseUrl).toBe("https://abcabcabc.supabase.co");
    expect(env.supabaseSecretKey).toBe("sb_secret_xxx");
    expect(env.supabasePublishableKey).toBe("sb_publishable_xxx");
    expect(env.maxDailySpendSek).toBe(200);
    expect(env.killSwitchPa).toBe(false);
    expect(env.anthropicApiKey).toBe("sk-ant-xxx");
    expect(env.anthropicModel).toBe("claude-sonnet-5");
    expect(env.maxCostPerAnalysisSek).toBe(5);
  });

  it("kastar och namnger PROJECT_URL när den saknas", () => {
    const record = giltigRecord();
    delete record["PROJECT_URL"];
    expect(() => lasEnv(record)).toThrowError(/PROJECT_URL/);
  });

  it("kastar och namnger PROJECT_SECRET_KEY när den saknas", () => {
    const record = giltigRecord();
    delete record["PROJECT_SECRET_KEY"];
    expect(() => lasEnv(record)).toThrowError(/PROJECT_SECRET_KEY/);
  });

  it("kastar och namnger ANTHROPIC_API_KEY när den saknas", () => {
    const record = giltigRecord();
    delete record["ANTHROPIC_API_KEY"];
    expect(() => lasEnv(record)).toThrowError(/ANTHROPIC_API_KEY/);
  });

  it("kastar och namnger MAX_DAILY_SPEND_SEK när den saknas", () => {
    const record = giltigRecord();
    delete record["MAX_DAILY_SPEND_SEK"];
    expect(() => lasEnv(record)).toThrowError(/MAX_DAILY_SPEND_SEK/);
  });

  it("kastar OgiltigMiljoError för en känd, saknad variabel", () => {
    const record = giltigRecord();
    delete record["PROJECT_URL"];
    expect(() => lasEnv(record)).toThrowError(OgiltigMiljoError);
  });

  it("effortGrounding/effortExtraction/effortJudging defaultar till 'medium' när miljövariablerna saknas (supervisorbeslut: shippad default, inte bara en opt-in)", () => {
    const env = lasEnv(giltigRecord());
    expect(env.effortGrounding).toBe("medium");
    expect(env.effortExtraction).toBe("medium");
    expect(env.effortJudging).toBe("medium");
  });

  it("läser ANTHROPIC_EFFORT_GROUNDING/EXTRACTION/JUDGING när satta till giltiga värden — de OVERRIDAR default", () => {
    const record = giltigRecord();
    record["ANTHROPIC_EFFORT_GROUNDING"] = "low";
    record["ANTHROPIC_EFFORT_EXTRACTION"] = "high";
    record["ANTHROPIC_EFFORT_JUDGING"] = "xhigh";

    const env = lasEnv(record);

    expect(env.effortGrounding).toBe("low");
    expect(env.effortExtraction).toBe("high");
    expect(env.effortJudging).toBe("xhigh");
  });

  it("kastar OgiltigMiljoError för ett ogiltigt ANTHROPIC_EFFORT_GROUNDING-värde", () => {
    const record = giltigRecord();
    record["ANTHROPIC_EFFORT_GROUNDING"] = "turbo";
    expect(() => lasEnv(record)).toThrowError(OgiltigMiljoError);
  });

  it("kastar OgiltigMiljoError för ett TOMT ANTHROPIC_EFFORT_EXTRACTION-värde — satt-men-tomt är inte samma sak som ospecificerat", () => {
    const record = giltigRecord();
    record["ANTHROPIC_EFFORT_EXTRACTION"] = "";
    expect(() => lasEnv(record)).toThrowError(OgiltigMiljoError);
  });

  it("kastar en egen, högljudd fel-typ om NÅGON nyckel i input-recordet är VITE_-prefixad", () => {
    const record = { ...giltigRecord(), VITE_NAGONTING: "hemlighet" };
    expect(() => lasEnv(record)).toThrowError(OsakerMiljoNyckelError);
    expect(() => lasEnv(record)).toThrowError(/VITE_NAGONTING/);
  });

  it("VITE_-vakten kontrollerar ALLA nycklar, inte bara de kända — även en okänd VITE_-nyckel utlöser felet", () => {
    const record = { ...giltigRecord(), VITE_HELT_OKAND_SAK: "x" };
    expect(() => lasEnv(record)).toThrowError(OsakerMiljoNyckelError);
  });

  it("VITE_-vakten går före övrig validering — den slår till även om andra fält saknas", () => {
    const record = giltigRecord();
    delete record["PROJECT_URL"];
    (record as Record<string, string | undefined>)["VITE_PROJECT_SECRET_KEY"] = "läckt";
    expect(() => lasEnv(record)).toThrowError(OsakerMiljoNyckelError);
  });

  describe("ANALYSIS_KILL_SWITCH → killSwitchPa", () => {
    it('"on" → true', () => {
      const env = lasEnv({ ...giltigRecord(), ANALYSIS_KILL_SWITCH: "on" });
      expect(env.killSwitchPa).toBe(true);
    });

    it('"off" → false', () => {
      const env = lasEnv({ ...giltigRecord(), ANALYSIS_KILL_SWITCH: "off" });
      expect(env.killSwitchPa).toBe(false);
    });

    it("frånvarande → false (default)", () => {
      const record = giltigRecord();
      delete record["ANALYSIS_KILL_SWITCH"];
      const env = lasEnv(record);
      expect(env.killSwitchPa).toBe(false);
    });

    it("ett godtyckligt annat värde → false, inte true", () => {
      const env = lasEnv({ ...giltigRecord(), ANALYSIS_KILL_SWITCH: "ON" });
      expect(env.killSwitchPa).toBe(false);
    });
  });

  describe("MAX_DAILY_SPEND_SEK", () => {
    it('"0" kastar — noll är inte ett positivt spendtak', () => {
      expect(() => lasEnv({ ...giltigRecord(), MAX_DAILY_SPEND_SEK: "0" })).toThrowError(
        /MAX_DAILY_SPEND_SEK/,
      );
    });

    it('"-5" kastar — negativt spendtak är meningslöst', () => {
      expect(() => lasEnv({ ...giltigRecord(), MAX_DAILY_SPEND_SEK: "-5" })).toThrowError(
        /MAX_DAILY_SPEND_SEK/,
      );
    });

    it('"abc" kastar — inte ett tal', () => {
      expect(() => lasEnv({ ...giltigRecord(), MAX_DAILY_SPEND_SEK: "abc" })).toThrowError(
        /MAX_DAILY_SPEND_SEK/,
      );
    });

    it('"200" parsas till talet 200', () => {
      const env = lasEnv({ ...giltigRecord(), MAX_DAILY_SPEND_SEK: "200" });
      expect(env.maxDailySpendSek).toBe(200);
    });
  });

  describe("defaultvärden", () => {
    it("MAX_COST_PER_ANALYSIS_SEK utelämnad → default 5", () => {
      const record = giltigRecord();
      delete record["MAX_COST_PER_ANALYSIS_SEK"];
      const env = lasEnv(record);
      expect(env.maxCostPerAnalysisSek).toBe(5);
    });

    it("ANTHROPIC_MODEL utelämnad → default 'claude-sonnet-5-5'", () => {
      const record = giltigRecord();
      delete record["ANTHROPIC_MODEL"];
      const env = lasEnv(record);
      expect(env.anthropicModel).toBe("claude-sonnet-5-5");
    });
  });

  it("PROJECT_PUBLISHABLE_KEY utelämnad → fältet är undefined/frånvarande i resultatet", () => {
    const record = giltigRecord();
    delete record["PROJECT_PUBLISHABLE_KEY"];
    const env = lasEnv(record);
    expect(env.supabasePublishableKey).toBeUndefined();
    // exactOptionalPropertyTypes: verifierar att fältet kan utelämnas helt,
    // inte bara sättas till undefined explicit.
    expect(
      "supabasePublishableKey" in env ? env.supabasePublishableKey : undefined,
    ).toBeUndefined();
  });

  it("avvisar en URL som inte ser ut som en URL för PROJECT_URL", () => {
    expect(() => lasEnv({ ...giltigRecord(), PROJECT_URL: "inte-en-url" })).toThrowError(
      /PROJECT_URL/,
    );
  });

  it("avvisar ett tomt PROJECT_SECRET_KEY", () => {
    expect(() => lasEnv({ ...giltigRecord(), PROJECT_SECRET_KEY: "" })).toThrowError(
      /PROJECT_SECRET_KEY/,
    );
  });

  it("avvisar ett tomt ANTHROPIC_API_KEY", () => {
    expect(() => lasEnv({ ...giltigRecord(), ANTHROPIC_API_KEY: "" })).toThrowError(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("ANNONS_HAMTNING och ANNONS_LLM_FALLBACK är valfria: saknas de är hämtningen på och modellreserven av", () => {
    const env = lasEnv(giltigRecord());
    expect(env.annonsHamtningAvstangd).toBe(false);
    expect(env.annonsLlmFallback).toBe(false);
  });

  it("ANNONS_HAMTNING=off stänger av hämtningen; andra värden gör det inte", () => {
    expect(lasEnv({ ...giltigRecord(), ANNONS_HAMTNING: "off" }).annonsHamtningAvstangd).toBe(true);
    expect(lasEnv({ ...giltigRecord(), ANNONS_HAMTNING: "on" }).annonsHamtningAvstangd).toBe(false);
    expect(lasEnv({ ...giltigRecord(), ANNONS_HAMTNING: "" }).annonsHamtningAvstangd).toBe(false);
  });

  it("ANNONS_LLM_FALLBACK=on slår på modellreserven; allt annat lämnar den av", () => {
    expect(lasEnv({ ...giltigRecord(), ANNONS_LLM_FALLBACK: "on" }).annonsLlmFallback).toBe(true);
    expect(lasEnv({ ...giltigRecord(), ANNONS_LLM_FALLBACK: "off" }).annonsLlmFallback).toBe(false);
    expect(lasEnv({ ...giltigRecord(), ANNONS_LLM_FALLBACK: "ja" }).annonsLlmFallback).toBe(false);
  });

  it("Booli-API: utan nycklar saknas fälten, BOOLI_API och ANNONS_SIDHAMTNING har sina standardvärden", () => {
    const env = lasEnv(giltigRecord());
    expect(env.booliCallerId).toBeUndefined();
    expect(env.booliPrivateKey).toBeUndefined();
    expect("booliCallerId" in env).toBe(false);
    expect(env.booliApiAvstangd).toBe(false);
    expect(env.annonsSidhamtning).toBe(false);
  });

  it("Booli-API: nycklarna läses (trimmade), en tom nyckel räknas som saknad", () => {
    const env = lasEnv({
      ...giltigRecord(),
      BOOLI_CALLER_ID: " binfo ",
      BOOLI_PRIVATE_KEY: "hemlig",
    });
    expect(env.booliCallerId).toBe("binfo");
    expect(env.booliPrivateKey).toBe("hemlig");
    const tom = lasEnv({ ...giltigRecord(), BOOLI_CALLER_ID: "", BOOLI_PRIVATE_KEY: " " });
    expect("booliCallerId" in tom).toBe(false);
    expect("booliPrivateKey" in tom).toBe(false);
  });

  it("BOOLI_API=off stänger av API:t; ANNONS_SIDHAMTNING=on slår på sidhämtningen; andra värden gör ingetdera", () => {
    expect(lasEnv({ ...giltigRecord(), BOOLI_API: "off" }).booliApiAvstangd).toBe(true);
    expect(lasEnv({ ...giltigRecord(), BOOLI_API: " OFF " }).booliApiAvstangd).toBe(true);
    expect(lasEnv({ ...giltigRecord(), BOOLI_API: "on" }).booliApiAvstangd).toBe(false);
    expect(lasEnv({ ...giltigRecord(), ANNONS_SIDHAMTNING: "on" }).annonsSidhamtning).toBe(true);
    expect(lasEnv({ ...giltigRecord(), ANNONS_SIDHAMTNING: "ja" }).annonsSidhamtning).toBe(false);
  });
});
