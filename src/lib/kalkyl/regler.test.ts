import { describe, expect, it } from "vitest";
import {
  KONSUMENTVERKET_2026,
  KV_GEMENSAMMA_SUMMA,
  KV_OVRIGA_SUMMA,
  MIN_KONTANTINSATS_ANDEL,
  REGELVERSION,
  REGLER,
  STATUS_ETIKETT,
  hittaRegel,
  reglerIGrupp,
  tal,
} from "./regler";
import { amorteringstakt } from "@/lib/analysis/calc/amortering";
import { schabloner } from "@/lib/analysis/calc/schabloner";
import { IBB_2026, PENSIONSAVGIFT_TAK_INKOMST, PBB_2026 } from "@/lib/skatt2026";

const sv = (id: string) => Number(hittaRegel(id)?.varde);

describe("regelregistret", () => {
  it("har unika id:n och full proveniens på varje post", () => {
    const ids = REGLER.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of REGLER) {
      expect(r.namn.length).toBeGreaterThan(0);
      expect(r.kalla.titel.length).toBeGreaterThan(0);
      expect(r.gallerFran).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (r.verifierad !== null) expect(r.verifierad).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("varje verifierad post har en käll-URL; poster utan URL är inte verifierade", () => {
    for (const r of REGLER) {
      if (r.verifierad !== null && r.id !== "kalp_barn_0_3") {
        expect(r.kalla.url, r.id).toMatch(/^https:\/\//);
      }
      if (r.kalla.url === null) {
        expect(["antagande", "schablon"]).toContain(r.status);
      }
    }
  });

  it("antaganden och schabloner är märkta som sådana, och overifierade poster är märkta Binfos uppskattning", () => {
    expect(hittaRegel("kalkylranta_standard")?.status).toBe("antagande");
    expect(hittaRegel("kalkylranta_standard")?.varde).toBe(7);
    expect(hittaRegel("skuldkvot_bankstak")?.anmarkning).toContain("Binfos uppskattning");
    expect(hittaRegel("skuldkvot_bankstak")?.anmarkning).toContain("7,1 %");
    // Bredband är den enda driftposten utan publicerad källa.
    const bredband = hittaRegel("schablon_bredband")!;
    expect(bredband.status).toBe("schablon");
    expect(bredband.verifierad).toBeNull();
    expect(bredband.anmarkning).toContain("Binfos uppskattning");
  });

  it("bolånetak 90 % ger minst 10 % kontantinsats", () => {
    expect(tal("bolanetak")).toBe(90);
    expect(MIN_KONTANTINSATS_ANDEL).toBe(0.1);
  });

  it("amorteringsgränserna är 50/70 och takterna 0/1/2, och funktionen följer registret", () => {
    expect([tal("amortering_troskel_lag"), tal("amortering_troskel_hog")]).toEqual([50, 70]);
    expect([
      tal("amortering_takt_lag"),
      tal("amortering_takt_mellan"),
      tal("amortering_takt_hog"),
    ]).toEqual([0, 1, 2]);
    expect(amorteringstakt(70)).toBe(tal("amortering_takt_mellan"));
    expect(amorteringstakt(70.01)).toBe(tal("amortering_takt_hog"));
  });

  it("skatte-konstanterna är de verifierade 2026-värdena", () => {
    expect(PBB_2026).toBe(59_200);
    expect(IBB_2026).toBe(83_400);
    expect(tal("skatt_kommunal")).toBe(30.55);
    expect(tal("skatt_skiktgrans")).toBe(643_000);
    expect(tal("skatt_publicservice_tak")).toBe(1_184);
    expect(PENSIONSAVGIFT_TAK_INKOMST).toBe(Math.round(8.07 * IBB_2026));
    expect(tal("ranteavdrag_tak")).toBe(100_000);
  });

  it("driftschablonerna i registret är samma som calc/schabloner.ts räknar med", () => {
    const a = schabloner(0, 1);
    const b = schabloner(10, 4);
    expect(a.varme.value).toBe(0);
    expect(b.varme.value).toBe(10 * sv("schablon_varme_per_m2"));
    // Vatten följer antal personer (sedan 2026-10-28), inte ytan.
    expect(a.vatten.value).toBe(1 * sv("schablon_vatten_per_person"));
    expect(b.vatten.value).toBe(4 * sv("schablon_vatten_per_person"));
    expect(a.bredband.value).toBe(sv("schablon_bredband"));
    // El och hemförsäkring slås upp i Konsumentverkets tabell, per antal personer.
    expect(a.el.value).toBe(sv("kv_gemensam_hushallsel_1"));
    expect(b.el.value).toBe(sv("kv_gemensam_hushallsel_4"));
    expect(a.forsakring.value).toBe(sv("kv_gemensam_hemforsakring_1"));
    expect(b.forsakring.value).toBe(sv("kv_gemensam_hemforsakring_4"));
  });

  it("driftvärdena är de beslutade 2026-10-26 (värme) och 2026-10-28 (vatten per person)", () => {
    expect(sv("schablon_varme_per_m2")).toBe(21);
    expect(sv("schablon_vatten_per_person")).toBe(135);
    expect(sv("schablon_bredband")).toBe(349);
    expect(hittaRegel("schablon_vatten_per_m2")).toBeUndefined();
    expect(REGELVERSION).toBe("2026-10-28");
    const varme = hittaRegel("schablon_varme_per_m2")!;
    expect(varme.status).toBe("referens");
    expect(varme.verifierad).toBe("2026-10-26");
    expect(varme.kalla.url).toMatch(/^https:\/\/nilsholgersson\.nu\//);
    expect(varme.namn).toMatch(/varmvatten/);
    expect(varme.anmarkning).toMatch(/varmvatten/);
    expect(varme.anmarkning).not.toMatch(/Binfos uppskattning/);

    const vatten = hittaRegel("schablon_vatten_per_person")!;
    expect(vatten.status).toBe("referens");
    expect(vatten.verifierad).toBe("2026-10-28");
    expect(vatten.enhet).toBe("kr/mån och person");
    expect(vatten.kalla.titel).toMatch(/Konsumentverket/);
    expect(vatten.kalla.titel).toMatch(/Nils Holgersson/);
    expect(vatten.kalla.titel).toMatch(/45,61 m³/);
    expect(vatten.kalla.titel).toMatch(/35,54 kr\/m³/);
    expect(vatten.kalla.url).toMatch(/^https:\/\/nilsholgersson\.nu\//);
    expect(vatten.anmarkning).toContain(
      "45,61 m³ × 35,54 kr/m³ ÷ 12 ≈ 135 kr per person och månad",
    );
    // Härledningen i texten ger det registrerade värdet.
    expect(Math.round((45.61 * 35.54) / 12)).toBe(sv("schablon_vatten_per_person"));
  });
});

describe("Konsumentverket Hushållskostnader 2026, tabellkontroll mot publicerade summor", () => {
  it("övriga individuella kostnader summerar till tabellens summor per åldersgrupp", () => {
    for (let i = 0; i < 10; i++) {
      const summa = Object.values(KONSUMENTVERKET_2026.ovriga).reduce((a, rad) => a + rad[i]!, 0);
      expect(summa).toBe(KV_OVRIGA_SUMMA[i]);
    }
  });

  it("gemensamma kostnader summerar till tabellens summor per hushållsstorlek", () => {
    for (let i = 0; i < 7; i++) {
      const summa = Object.values(KONSUMENTVERKET_2026.gemensamma).reduce(
        (a, rad) => a + rad[i]!,
        0,
      );
      expect(summa).toBe(KV_GEMENSAMMA_SUMMA[i]);
    }
  });

  it("varje tabellcell finns som post i registret", () => {
    expect(hittaRegel("kv_mat_25-50")?.varde).toBe(2730);
    expect(hittaRegel("kv_gemensam_hushallsel_2")?.varde).toBe(530);
    expect(hittaRegel("kv_klader_skor_71+")?.varde).toBe(720);
    expect(hittaRegel("kalp_barn_under_8_avdrag")?.varde).toBe(229);
  });
});

describe("text som användaren ser", () => {
  const FORBJUDET = /TODO|placeholder|ägarbeslut/i;

  it("ingen regel innehåller TODO, placeholder eller ägarbeslut i någon textfält", () => {
    for (const r of REGLER) {
      const falt = [
        r.id,
        r.namn,
        r.enhet,
        r.grupp,
        r.kalla.titel,
        r.referens ?? "",
        r.anmarkning ?? "",
        typeof r.varde === "string" ? r.varde : "",
      ];
      for (const f of falt) expect(f, `${r.id}: ${f}`).not.toMatch(FORBJUDET);
    }
    for (const etikett of Object.values(STATUS_ETIKETT)) expect(etikett).not.toMatch(FORBJUDET);
  });

  it("schablonernas basistexter är fria från interna markörer", () => {
    for (const [boarea, personer] of [
      [0, 0],
      [57, 2],
    ] as const) {
      for (const figur of Object.values(schabloner(boarea, personer))) {
        expect(figur.schablonBasis ?? "").not.toMatch(FORBJUDET);
      }
    }
  });

  it("poster utan publicerad källa märks Binfos uppskattning/antagande", () => {
    for (const r of REGLER.filter((x) => x.status === "schablon")) {
      expect(r.anmarkning).toMatch(/Binfos uppskattning/);
    }
    expect(hittaRegel("skuldkvot_bankstak")?.anmarkning).toMatch(/Binfos uppskattning/);
    expect(hittaRegel("kalkylranta_standard")?.anmarkning).toMatch(/Binfos antagande/);
  });
});
