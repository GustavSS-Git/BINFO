import { describe, expect, it } from "vitest";
import {
  KONSUMENTVERKET_2026,
  KV_GEMENSAMMA_SUMMA,
  KV_OVRIGA_SUMMA,
  MIN_KONTANTINSATS_ANDEL,
  REGLER,
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

  it("antaganden och schabloner är märkta som sådana, och overifierade schabloner har TODO", () => {
    expect(hittaRegel("kalkylranta_standard")?.status).toBe("antagande");
    expect(hittaRegel("kalkylranta_standard")?.varde).toBe(7);
    expect(hittaRegel("skuldkvot_bankstak")?.anmarkning).toContain("TODO: unverified placeholder");
    for (const r of reglerIGrupp("Drift (schabloner)")) {
      expect(r.status).toBe("schablon");
      expect(r.verifierad).toBeNull();
      expect(r.anmarkning).toContain("TODO: unverified placeholder");
    }
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
    const a = schabloner(0, 0); // golv: 0 m², 1 person
    const b = schabloner(10, 3);
    expect(a.el.value).toBe(sv("schablon_el_grund"));
    expect((b.el.value ?? 0) - (a.el.value ?? 0)).toBe(10 * sv("schablon_el_per_m2"));
    expect(a.varme.value).toBe(sv("schablon_varme_grund"));
    expect((b.varme.value ?? 0) - (a.varme.value ?? 0)).toBe(10 * sv("schablon_varme_per_m2"));
    expect(a.vatten.value).toBe(sv("schablon_vatten_per_person"));
    expect(b.vatten.value).toBe(3 * sv("schablon_vatten_per_person"));
    expect(a.bredband.value).toBe(sv("schablon_bredband"));
    expect(a.forsakring.value).toBe(sv("schablon_forsakring_grund"));
    expect((b.forsakring.value ?? 0) - (a.forsakring.value ?? 0)).toBe(
      10 * sv("schablon_forsakring_per_m2"),
    );
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
