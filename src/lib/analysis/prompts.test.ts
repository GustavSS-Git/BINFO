import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ALLA_NYCKELTAL,
  PROMPT_VERSION,
  TRANSKRIPTION_PROMPT_VERSION,
  buildAnalysSystemPrompt,
  buildAnalysUserPrompt,
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  buildGroundingSystemPrompt,
  buildGroundingUserPrompt,
  buildMotiveringSystemPrompt,
  buildMotiveringUserPrompt,
  buildTranskriberingSystemPrompt,
  buildTranskriberingUserPrompt,
  extractGroundingFindings,
  formatGroundingForExtraction,
} from "./prompts";
import {
  AnalysJudgementSchema,
  ExtractionResultSchema,
  KeyFigureIdSchema,
  KontrollsummorSchema,
  StatusSchema,
} from "./schema";
import { extraktion } from "./__fixtures__/extraktion";
import { tillatnaSidor } from "./analyze";
import { BENCHMARKS } from "./benchmarks";
import type { KeyFigureId } from "@/types/analysis";
import { beraknaFastaVarden } from "./fastaVarden";

describe("ALLA_NYCKELTAL", () => {
  it("innehåller exakt de sju id:n som KeyFigureIdSchema tillåter", () => {
    const idsIPrompt = ALLA_NYCKELTAL.map((n) => n.id).sort();
    const idsISchema = [...KeyFigureIdSchema.options].sort();
    expect(idsIPrompt).toEqual(idsISchema);
  });

  it("varje nyckeltal har en icke-tom svensk etikett", () => {
    for (const n of ALLA_NYCKELTAL) {
      expect(n.label.length).toBeGreaterThan(0);
    }
  });
});

describe("buildGroundingSystemPrompt", () => {
  it("nämner alla sju nyckeltalens etiketter — annars kan modellen missa ett", () => {
    const prompt = buildGroundingSystemPrompt();
    for (const n of ALLA_NYCKELTAL) {
      expect(prompt).toContain(n.label);
    }
  });
});

describe("buildGroundingSystemPrompt — task 1.5 extra fält", () => {
  it("instruerar att ta årets medlemsantal, inte jämförelsetalet inom parentes för föregående år", () => {
    const prompt = buildGroundingSystemPrompt();
    expect(prompt).toMatch(/medlem/i);
    expect(prompt).toContain("43 (41)");
    expect(prompt).toMatch(/inte jämförelsetalet|föregående år/i);
  });

  it("varnar för att förväxla lokaler/hyresrätter med areauppgifter och gemensamhetsutrymmen", () => {
    const prompt = buildGroundingSystemPrompt();
    expect(prompt).toMatch(/hyresrätt/i);
    expect(prompt).toMatch(/lokal/i);
    expect(prompt).toMatch(/föreningslokal|samlingslokal/i);
  });

  it("varnar uttryckligen för försäkrings-fällan — en mening om fastighetsförsäkring är inte ett svar om avgiften", () => {
    const prompt = buildGroundingSystemPrompt();
    expect(prompt).toMatch(/fastighetsförsäkring/i);
    expect(prompt).toMatch(/INTE om vad som ingår/i);
  });

  it("instruerar om individuell mätning (IMD)", () => {
    const prompt = buildGroundingSystemPrompt();
    expect(prompt).toMatch(/individuell mätning|IMD/i);
  });
});

describe("buildExtractionSystemPrompt", () => {
  it("listar alla sju id-strängar ordagrant — modellen har annars gissat egna förkortningar i praktiken", () => {
    const prompt = buildExtractionSystemPrompt();
    for (const n of ALLA_NYCKELTAL) {
      expect(prompt).toContain(`"${n.id}"`);
    }
  });

  it("instruerar modellen att alltid sätta status till 'okant' — bedömningen görs deterministiskt i ett senare steg, inte av modellen", () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toMatch(/status.*"okant"/s);
    // Ska inte längre be modellen välja mellan de andra fyra värdena.
    for (const status of StatusSchema.options.filter((s) => s !== "okant")) {
      expect(prompt).not.toContain(`"${status}"`);
    }
  });

  it("instruerar att excerpt alltid ska sättas för citerade figurer — annars bevisar en sidhänvisning ingenting", () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toContain("excerpt");
  });

  it("instruerar att kommandeAtgarder är en array av {text, ref?} — inte en platt sträng-array", () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toContain("kommandeAtgarder");
    expect(prompt).toMatch(/kommandeAtgarder.*array/i);
  });

  it("instruerar modellen att kopiera en icke-numerisk cell (t.ex. 'neg') ordagrant till figure.tryckt, och att aldrig sätta tecken själv", () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toContain("tryckt");
    expect(prompt).toMatch(/neg/);
    expect(prompt).toMatch(/aldrig.*tecken|tecken.*aldrig/is);
  });

  it("instruerar att ref är valfritt (utelämnas, inte null) när ingen exakt sida hittas", () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toMatch(/ref.*valfritt/i);
  });

  it("instruerar om avgiftInkluderarEnligtForening", () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toContain("avgiftInkluderarEnligtForening");
  });

  it("instruerar om avgiftInkluderarKallor — en källa per post rapporten tagit entydig ställning till", () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toContain("avgiftInkluderarKallor");
    expect(prompt).toMatch(/"ja" eller "nej"/);
  });

  it("instruerar om individuellMatning och att 'matning' aldrig är 'okant'", () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toContain("individuellMatning");
    expect(prompt).toMatch(/ALDRIG "okant"/);
  });

  it("instruerar om antalMedlemmar, antalHyresratter och antalLokaler", () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toContain("antalMedlemmar");
    expect(prompt).toContain("antalHyresratter");
    expect(prompt).toContain("antalLokaler");
    expect(prompt).toContain("43 (41)");
  });

  it("varnar mot försäkrings-fällan även i extraktionsprompten", () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toMatch(/fastighetsförsäkring/i);
  });
});

describe("extractGroundingFindings", () => {
  it("plockar ut citat av typen page_location ur textblock", () => {
    const blocks = [
      {
        type: "text",
        text: "Skulden uppgår till 43,2 Mkr.",
        citations: [
          {
            type: "page_location",
            cited_text: "Föreningens lån uppgår till 43 200 000 kr.",
            start_page_number: 7,
            end_page_number: 7,
          },
        ],
      },
    ];

    const findings = extractGroundingFindings(blocks);

    expect(findings).toEqual([
      {
        text: "Skulden uppgår till 43,2 Mkr.",
        citat: "Föreningens lån uppgår till 43 200 000 kr.",
        sida: 7,
      },
    ]);
  });

  it("ignorerar textblock utan citations", () => {
    const blocks = [{ type: "text", text: "Ingen källa angiven." }];
    expect(extractGroundingFindings(blocks)).toEqual([]);
  });

  it("ignorerar citat som inte är page_location", () => {
    const blocks = [
      {
        type: "text",
        text: "Text",
        citations: [{ type: "char_location", cited_text: "något" }],
      },
    ];
    expect(extractGroundingFindings(blocks)).toEqual([]);
  });

  it("hanterar flera citat i samma block och flera block", () => {
    const blocks = [
      {
        type: "text",
        text: "A",
        citations: [
          { type: "page_location", cited_text: "citat1", start_page_number: 1 },
          { type: "page_location", cited_text: "citat2", start_page_number: 2 },
        ],
      },
      {
        type: "text",
        text: "B",
        citations: [{ type: "page_location", cited_text: "citat3", start_page_number: 3 }],
      },
    ];
    expect(extractGroundingFindings(blocks)).toHaveLength(3);
  });
});

describe("formatGroundingForExtraction", () => {
  it("numrerar fynden och inkluderar sida och citat", () => {
    const text = formatGroundingForExtraction([
      { text: "Skulden är hög.", citat: "43 200 000 kr", sida: 7 },
    ]);
    expect(text).toContain("1.");
    expect(text).toContain("Sida 7");
    expect(text).toContain("43 200 000 kr");
  });

  it("hanterar en tom lista utan att krascha", () => {
    expect(() => formatGroundingForExtraction([])).not.toThrow();
    expect(formatGroundingForExtraction([]).length).toBeGreaterThan(0);
  });
});

describe("PROMPT_VERSION 9: lån, ytor, byggår och nya fält", () => {
  const grund = buildGroundingSystemPrompt();
  const extr = buildExtractionSystemPrompt();

  it("grundningen letar efter varje lån med villkorsändringsdag, räntekostnader och rörlig/bunden", () => {
    expect(grund).toMatch(/VARJE enskilt lån/);
    expect(grund).toMatch(/villkorsändringsdag/);
    expect(grund).toMatch(/konverteringsdag/);
    expect(grund).toMatch(/Räntekostnader och liknande resultatposter/);
    expect(grund).toMatch(/balansdagen/);
  });

  it("grundningen letar efter underhållsbelopp, fond, avsättning, uttag, lokaler och energiprojekt", () => {
    expect(grund).toMatch(/BELOPP/);
    expect(grund).toMatch(/Fond för yttre underhåll/);
    expect(grund).toMatch(/Negativt sparande/);
    expect(grund).toMatch(/Lokaler:/);
    expect(grund).toMatch(/Energiprojekt/);
  });

  it("extraktionen: lan ersätter forfalloprofil i exemplet och koden härleder profilen", () => {
    expect(extr).toContain('"lan": [');
    expect(extr).not.toContain('"forfalloprofil": [');
    expect(extr).toMatch(/Skriv INTE forfalloprofil när du anger lan/);
    expect(extr).toMatch(/rantetyp är "rorlig" ENDAST/);
    expect(extr).toMatch(/hitta aldrig på en dag/);
  });

  it("extraktionen: totalyta och bostadsrattsyta är olika tal med olika citat i exemplet", () => {
    const exempel = JSON.parse(
      extr.slice(extr.indexOf('{\n  "schemaVersion"'), extr.indexOf("\n\nSkarpa regler")),
    );
    const f = exempel.forening;
    expect(f.totalyta.value).not.toBe(f.bostadsrattsyta.value);
    expect(f.totalyta.ref.excerpt).not.toBe(f.bostadsrattsyta.ref.excerpt);
    expect(exempel.kontrollsummor.bostadsrattsyta.value).toBe(f.bostadsrattsyta.value);
    expect(extr).not.toContain("total bostadsarea om 3 200 kvm");
    expect(extr).toMatch(/OLIKA tal/);
  });

  it("extraktionen: byggår är uppförandeår, värdeår bara som sista utväg, och 'byggår saknas' hör inte hemma i skal", () => {
    expect(extr).toMatch(/Värdeår/i);
    expect(extr).toMatch(/uppfördes/);
    expect(extr).toMatch(/excerpt visa att det står "värdeår"/);
    expect(extr).toMatch(
      /Skriv aldrig i datakvalitet\.extraktionKonfidens\.skal att byggår saknas/,
    );
    expect(grund).toMatch(/INTE "värdeår" som byggår/);
  });

  it("extraktionen: nya fält i exemplet validerar mot schemat", () => {
    const exempel = JSON.parse(
      extr.slice(extr.indexOf('{\n  "schemaVersion"'), extr.indexOf("\n\nSkarpa regler")),
    );
    const f = exempel.forening;
    expect(f.balansdag).toBe("2025-12-31");
    expect(f.lanebok.lan).toHaveLength(2);
    expect(f.underhallsplan.planeradeKostnader[0].finansiering).toBe("lan");
    expect(f.lokaler.kontrakt[0].slutdatum).toBe("2026-09-30");
    expect(f.energiprojekt[0].finansierat).toBe("okant");
    expect(f.sparandeUttag.ref.excerpt).toBeTruthy();
  });

  it("extraktionen: bara planerade kostnader med belopp, sparandeUttag och kontrakt kräver citat", () => {
    expect(extr).toMatch(/ENDAST planerade kostnader där rapporten anger ett belopp/);
    expect(extr).toMatch(/sparandeUttag: ENDAST/);
    expect(extr).toMatch(/ref med excerpt obligatoriskt/);
  });
});

describe("buildAnalysSystemPrompt", () => {
  it("förbjuder uttryckligen modellen att omvärdera de sju nyckeltalen — bedömningen är redan gjord deterministiskt", () => {
    const prompt = buildAnalysSystemPrompt();
    expect(prompt).toMatch(/omvärdera|inte om|aldrig.*status/i);
    expect(prompt).toContain("status");
    expect(prompt).toMatch(/deterministisk/i);
  });

  it("säger att modellen ska resonera om kombinationen av nyckeltal, lån och underhåll", () => {
    const prompt = buildAnalysSystemPrompt();
    expect(prompt).toMatch(/kombination/i);
    expect(prompt).toContain("forfalloprofil");
    expect(prompt).toContain("underhallsplan");
  });

  it("förbjuder påhittade sidnummer — endast sidor som finns i underlaget får användas", () => {
    const prompt = buildAnalysSystemPrompt();
    expect(prompt).toMatch(/sidnummer/i);
    expect(prompt).toMatch(/hitta aldrig på|aldrig hitta på/i);
  });

  it("förbjuder påhittade riktvärden, snitt och lagkrav", () => {
    const prompt = buildAnalysSystemPrompt();
    expect(prompt).toMatch(/riksgenomsnitt|snitt|riktvärde/i);
    expect(prompt).toMatch(/lagkrav|lagstadgad|lag/i);
  });

  it("upprätthåller okant-disciplinen — ett okänt tal får inte argumenteras som ett dåligt tal", () => {
    const prompt = buildAnalysSystemPrompt();
    expect(prompt).toContain("okant");
    expect(prompt).toMatch(/okänt är inte|inte detsamma som/i);
  });

  it("säger att de medvetet ograderade nyckeltalen alltid har status 'okant' — annars läses de som saknade uppgifter", () => {
    const prompt = buildAnalysSystemPrompt();
    const ejGraderade = (Object.keys(BENCHMARKS) as KeyFigureId[]).filter(
      (id) => BENCHMARKS[id].riktning === "informativ",
    );
    expect(ejGraderade.length).toBeGreaterThan(0);
    for (const id of ejGraderade) {
      expect(prompt).toContain(`"${id}"`);
    }
    expect(prompt).toMatch(/graderas medvetet inte|graderas inte/i);
    expect(prompt).toMatch(/figure\.value/);
  });

  it("listar alla sju id-strängar ordagrant — harledsFran får bara innehålla dessa", () => {
    const prompt = buildAnalysSystemPrompt();
    expect(prompt).toContain("harledsFran");
    for (const n of ALLA_NYCKELTAL) {
      expect(prompt).toContain(`"${n.id}"`);
    }
  });

  it("kräver ursprung 'analys' på varje fråga — saknad_uppgift genereras på annat håll", () => {
    const prompt = buildAnalysSystemPrompt();
    expect(prompt).toContain('"analys"');
    expect(prompt).toContain("saknad_uppgift");
  });

  it("är skriven på svenska — allt en köpare läser ska vara svenskt", () => {
    const prompt = buildAnalysSystemPrompt();
    expect(prompt).toMatch(/[åäöÅÄÖ]/);
  });

  // Swedish numerals, written out independently of the implementation on
  // purpose: the point of this test is to catch the prompt claiming a count
  // that no longer matches BENCHMARKS.
  const RAKNEORD: Record<number, string> = {
    0: "noll",
    1: "Ett",
    2: "Två",
    3: "Tre",
    4: "Fyra",
    5: "Fem",
    6: "Sex",
    7: "Sju",
  };

  const ejGraderade = (Object.keys(BENCHMARKS) as KeyFigureId[]).filter(
    (id) => BENCHMARKS[id].riktning === "informativ",
  );

  it("anger antalet ograderade nyckeltal med det räkneord som faktiskt stämmer med BENCHMARKS", () => {
    const prompt = buildAnalysSystemPrompt();
    expect(ejGraderade.length).toBeGreaterThan(0);
    expect(prompt).toContain(
      `${RAKNEORD[ejGraderade.length]} av de sju nyckeltalen har ALLTID status "okant"`,
    );
  });

  it("innehåller inget annat räkneord i samma mening — en hårdkodad siffra ska inte kunna bli inaktuell", () => {
    const prompt = buildAnalysSystemPrompt();
    for (const [antal, ord] of Object.entries(RAKNEORD)) {
      if (Number(antal) === ejGraderade.length) continue;
      expect(prompt).not.toContain(`${ord} av de sju nyckeltalen`);
    }
  });

  it("är grammatiskt konsekvent i singular/plural kring de ograderade nyckeltalen", () => {
    const prompt = buildAnalysSystemPrompt();
    if (ejGraderade.length === 1) {
      expect(prompt).toContain("Det graderas medvetet inte");
      expect(prompt).not.toContain("De graderas medvetet inte");
    } else {
      expect(prompt).toContain("De graderas medvetet inte");
      expect(prompt).not.toContain("Det graderas medvetet inte");
    }
  });

  it("återger varje kommentar i BENCHMARKS ordagrant — förbehållen skrivs inte om för hand", () => {
    const prompt = buildAnalysSystemPrompt();
    const medKommentar = (Object.keys(BENCHMARKS) as KeyFigureId[]).filter(
      (id) => BENCHMARKS[id].kommentar !== undefined,
    );
    expect(medKommentar.length).toBeGreaterThan(0);
    for (const id of medKommentar) {
      expect(prompt).toContain(BENCHMARKS[id].kommentar);
      expect(prompt).toContain(`"${id}"`);
    }
  });

  it("låter modellen förklara ett planerat uttag ur kassan i löptext utan att omvärdera statusen", () => {
    const prompt = buildAnalysSystemPrompt();
    // Prosakontexten är tillåten ...
    expect(prompt).toContain("vasentligaHandelser");
    expect(prompt).toContain("underhallsplan");
    expect(prompt).toMatch(/planerat och redovisat uttag/i);
    expect(prompt).toMatch(/severity/);
    expect(prompt).toMatch(/betyg/i);
    // ... men omvärderingen är det fortfarande inte.
    expect(prompt).toMatch(/inte sätta en egen status/i);
    expect(prompt).toMatch(/Statusen står kvar/i);
  });

  it("väger in byggåret innan en hög energikostnad beskrivs som misskötsel", () => {
    const prompt = buildAnalysSystemPrompt();
    expect(prompt).toContain("forening.byggar");
    expect(prompt).toMatch(/1960/);
  });

  it("lämnar inga oersatta platshållare eller tomma värden i prompten", () => {
    const prompt = buildAnalysSystemPrompt();
    for (const skrap of ["undefined", "NaN", "[object Object]", "${", "TODO"]) {
      expect(prompt).not.toContain(skrap);
    }
    expect(prompt).not.toMatch(/\n\n\n/);
  });
});

describe("buildAnalysUserPrompt", () => {
  it("bäddar in extraktionen som JSON", () => {
    const prompt = buildAnalysUserPrompt(extraktion, tillatnaSidor(extraktion));
    expect(prompt).toContain("Brf Kastanjen");
    expect(prompt).toContain("rantekanslighet");
  });

  it("räknar upp exakt de sidnummer som får användas i en ref", () => {
    const prompt = buildAnalysUserPrompt(extraktion, tillatnaSidor(extraktion));
    expect(prompt).toMatch(/3, 4, 6, 8, 12/);
  });
});

describe("tvetydig skuldsättningsbas (ägarbeslut 2026-09-25)", () => {
  it("grundning och extraktion lägger en otydlig skuld per kvm under bostadsrättsyta", () => {
    for (const prompt of [buildGroundingSystemPrompt(), buildExtractionSystemPrompt()]) {
      expect(prompt).toContain("Lån per kvm bostadsyta");
      expect(prompt).toContain("skuldsattning_per_m2_brf_yta");
    }
  });
});

describe("total räntebärande skuld = långfristig + kortfristig del (PROMPT_VERSION 6)", () => {
  it("grundningen ber om BÅDA delarna, oavsett vad posten heter (Zederslundshus: 'Övriga skulder' + 'Kortfr.del av skuld')", () => {
    const p = buildGroundingSystemPrompt();
    expect(p).toMatch(/långfristiga och den kortfristiga/);
    expect(p).toContain("Kortfr. del av skuld");
    expect(p).toContain("Övriga skulder");
    expect(p).toMatch(/citera båda delarna/);
  });

  it("extraktionen summerar delarna till lanebok.totalSkuld: berakning med den större delens ref, eller en tryckt total", () => {
    const p = buildExtractionSystemPrompt();
    expect(p).toMatch(/lanebok\.totalSkuld är SUMMAN av den långfristiga och den kortfristiga/);
    expect(p).toMatch(/Missa aldrig den kortfristiga delen/);
    expect(p).toMatch(/tryckt totalsumma/);
    expect(p).toMatch(/source "berakning" med ref\/excerpt från den STÖRRE delen/);
  });
});

describe("tvetydig skuldbas: 'Skuldsättningsgrad kr/kvm' (PROMPT_VERSION 6)", () => {
  it("båda promptarna nämner etiketten som ett exempel på oklar bas — den ska under bostadsrättsyta, inte totalyta (Zederslundshus)", () => {
    expect(buildGroundingSystemPrompt()).toContain("Skuldsättningsgrad kr/kvm");
    const p = buildExtractionSystemPrompt();
    expect(p).toContain("Skuldsättningsgrad kr/kvm");
    expect(p).toMatch(/säger etiketten inte uttryckligen "totalyta" är basen oklar/);
  });
});

describe("kontrollsummor (PROMPT_VERSION 6)", () => {
  it("grundningen ber om de fem kontrollsummorna", () => {
    const p = buildGroundingSystemPrompt();
    expect(p).toMatch(/Kontrollsummor/);
    expect(p).toContain("Summa tillgångar");
    expect(p).toContain("Summa eget kapital och skulder");
    expect(p).toMatch(/Årsavgifter/);
    expect(p).toMatch(/bostadsrättsyta/);
    expect(p).toMatch(/räntebärande skulderna/);
  });

  it("extraktionens JSON-exempel innehåller alla fem fälten i kontrollsummor, och en saknad uppgift utelämnas (aldrig 0)", () => {
    const p = buildExtractionSystemPrompt();
    expect(p).toContain('"kontrollsummor": {');
    for (const nyckel of [
      "summaTillgangar",
      "summaEgetKapitalOchSkulder",
      "arsavgifter",
      "bostadsrattsyta",
      "rantebarandeSkulder",
    ]) {
      expect(p).toContain(`"${nyckel}":`);
    }
    expect(p).toMatch(/UTELÄMNAS helt ur kontrollsummor \(skriv aldrig 0 eller null/);
  });

  it("exemplet i prompten följer kontraktet: kontrollsummorna validerar mot ExtractionResultSchema", () => {
    const p = buildExtractionSystemPrompt();
    const start = p.indexOf('"kontrollsummor": {');
    const slut = p.indexOf("\n  }\n}", start);
    const block = JSON.parse(`{${p.slice(start, slut + 4)}}`) as { kontrollsummor: unknown };
    expect(KontrollsummorSchema.safeParse(block.kontrollsummor).success).toBe(true);
  });
});

describe("föreningens adress(er) och fastighetsbeteckning(ar) (PROMPT_VERSION 7)", () => {
  it("grundningen ber om fastighetsbeteckning och gatuadress med postnummer och ort, och utesluter andras adresser", () => {
    const p = buildGroundingSystemPrompt();
    expect(p).toMatch(/Föreningens fastighet\(er\) och adress\(er\)/);
    expect(p).toContain("fastighetsbeteckning(ar)");
    expect(p).toMatch(/postnummer och ort/);
    expect(p).toMatch(/inte förvaltarens, revisorns, styrelseledamöternas/);
    expect(p).toMatch(/gissa aldrig/);
  });

  it("extraktionen fyller adresser och fastighetsbeteckningar bara när fynden anger dem, och utelämnar annars fältet", () => {
    const p = buildExtractionSystemPrompt();
    expect(p).toContain('"adresser": [');
    expect(p).toContain('"fastighetsbeteckningar": [');
    expect(p).toMatch(/adresser: föreningens EGNA gatuadress\(er\)/);
    expect(p).toMatch(/Utelämna hela fältet när fynden inte anger någon gatuadress/);
    expect(p).toMatch(/fastighetsbeteckningar: föreningens fastighetsbeteckning\(ar\)/);
  });

  it("exemplet i prompten följer kontraktet: adresser och fastighetsbeteckningar validerar mot ExtractionResultSchema", () => {
    const p = buildExtractionSystemPrompt();
    const start = p.indexOf('{\n  "schemaVersion"');
    const slut = p.indexOf("\n}\n\nSkarpa regler", start);
    const exempel = JSON.parse(p.slice(start, slut + 2)) as {
      forening: { adresser: unknown; fastighetsbeteckningar: unknown };
    };
    expect(exempel.forening.adresser).toBeDefined();
    const resultat = ExtractionResultSchema.safeParse({
      ...extraktion,
      forening: {
        ...extraktion.forening,
        adresser: exempel.forening.adresser,
        fastighetsbeteckningar: exempel.forening.fastighetsbeteckningar,
      },
    });
    expect(resultat.success, JSON.stringify(resultat.error?.issues)).toBe(true);
  });

  it("schemat avvisar en adress utan citat och ett postnummer som inte är fem siffror", () => {
    const med = (adresser: unknown) =>
      ExtractionResultSchema.safeParse({
        ...extraktion,
        forening: { ...extraktion.forening, adresser },
      }).success;
    expect(
      med([{ gatuadress: "Exempelvägen 12", ref: { page: 3, excerpt: "Exempelvägen 12" } }]),
    ).toBe(true);
    expect(med([{ gatuadress: "Exempelvägen 12", ref: { page: 3 } }])).toBe(false);
    expect(
      med([{ gatuadress: "Exempelvägen 12", postnummer: "1234", ref: { page: 3, excerpt: "x" } }]),
    ).toBe(false);
  });
});

describe("frågornas varför och svarssignal (PROMPT_VERSION 8)", () => {
  const prompt = buildAnalysSystemPrompt();

  it("kräver att varfor namnger det specifika fyndet och talet ur underlaget, och hänvisar till regeln mot utomstående siffror", () => {
    expect(prompt).toMatch(/"varfor" på en fråga är en eller två korta meningar/);
    expect(prompt).toMatch(/konkreta (siffra|siffror|tal)/);
    expect(prompt).toMatch(/aldrig ett tal som inte står i underlaget/);
    expect(prompt).toMatch(/regel 1/);
  });

  it("säger att en fråga utan enskilt fynd ska förklara varför den spelar roll och hur svaret påverkar köparen", () => {
    expect(prompt).toMatch(/inte kopplad till ett enskilt fynd/);
    expect(prompt).toMatch(/avgift, budnivå eller risk/);
  });

  it("beskriver svarssignal som valfri, i formen 'Bra svar: … Varningssignal: …', och att nyckeln utelämnas hellre än lämnas tom", () => {
    expect(prompt).toContain('"svarssignal" är valfri');
    expect(prompt).toContain("Bra svar:");
    expect(prompt).toContain("Varningssignal:");
    expect(prompt).toMatch(/utelämna nyckeln helt/);
  });

  it("förtydligar 'alla textfält ska vara ifyllda' så att valfria fält utelämnas, aldrig lämnas tomma", () => {
    expect(prompt).toMatch(/Alla textfält som du skriver ska vara ifyllda/);
    expect(prompt).toMatch(/Valfria fält utelämnas helt, de skrivs aldrig som tom sträng/);
  });

  it("JSON-exemplet visar svarssignal och ett varför med fynd och siffra, och validerar mot omdömesschemat", () => {
    const start = prompt.indexOf('{\n  "betyg"');
    const slut = prompt.indexOf("\n}\n\nSkarpa regler", start);
    const exempel = JSON.parse(prompt.slice(start, slut + 2)) as {
      fragor: Array<{ varfor: string; svarssignal?: string }>;
    };
    expect(exempel.fragor[0]!.svarssignal).toMatch(/^Bra svar: .* Varningssignal: /);
    expect(exempel.fragor[0]!.varfor).toMatch(/\d/);
    expect(AnalysJudgementSchema.safeParse(exempel).success).toBe(true);
  });
});

describe("fasta värden och betygsskalan (PROMPT_VERSION 8)", () => {
  const system = buildAnalysSystemPrompt();

  it("E kräver minst ett nyckeltal med status kritisk; en allvarlig risk utan kritisk ger som mest C och en röd flagga med severity hog", () => {
    expect(system).toContain(
      '- "E": flera nyckeltal med status "kritisk" som förstärker varandra, eller ett nyckeltal med status "kritisk" tillsammans med en uttalad risk i väsentliga händelser som föreningen inte visar sig kunna bära.',
    );
    expect(system).toContain(
      'En allvarlig risk i väsentliga händelser utan något nyckeltal med status "kritisk" ger som mest betyget C, och ska beskrivas i en röd flagga med severity "hog".',
    );
    // The old wording that allowed E without any kritisk figure is gone.
    expect(system).not.toContain('kritisk" som förstärker varandra, eller en uttalad risk');
  });

  it("A-D i betygsskalan är oförändrade", () => {
    expect(system).toContain(
      '- "A": inget nyckeltal har status "svag" eller "kritisk", och inget i lånebilden eller underhållsplanen pekar mot en betydande kostnad som inte redan är finansierad.',
    );
    expect(system).toContain(
      '- "B": högst ett nyckeltal med status "svag", inget "kritisk", och kommande åtgärder framstår som hanterbara.',
    );
    expect(system).toContain('- "C": flera nyckeltal med status "svag", ELLER ett med "kritisk"');
    expect(system).toContain('- "D": ett eller flera nyckeltal med status "kritisk" som förstärks');
  });

  it("modellen räknar aldrig själv: fasta värden, kopiera tal, avrundning av procent tillåten, inga tal utifrån", () => {
    expect(system).not.toContain("Du får räkna ut andelar och summor");
    expect(system).toContain('under "Fasta värden"');
    expect(system).toMatch(/Varje tal i "betygMotivering"/);
    expect(system).toContain("74,2 blir 74 %");
    expect(system).toMatch(/Räkna aldrig själv/);
    expect(system).toMatch(/aldrig in en siffra utifrån/);
  });

  it("användarprompten har ett tydligt märkt block med fasta värden och tillåtna betyg", () => {
    const user = buildAnalysUserPrompt(extraktion, tillatnaSidor(extraktion));
    expect(user).toContain(
      "## Fasta värden (beräknade av Binfo ur underlaget — använd exakt dessa tal, räkna aldrig om dem)",
    );
    expect(user).toMatch(/Tillåtna betyg: [A-E](, [A-E])*/);
    expect(user).toContain("Total räntebärande skuld: 52 000 000 kr");
    expect(user).toContain("2026: 31 000 000 kr (59,6 % av totala skulden)");
    // The block is the same one beraknaFastaVarden gives (an explicit argument wins).
    expect(
      buildAnalysUserPrompt(extraktion, tillatnaSidor(extraktion), beraknaFastaVarden(extraktion)),
    ).toBe(user);
  });
});

describe("buildMotiveringSystemPrompt / buildMotiveringUserPrompt", () => {
  const fasta = beraknaFastaVarden(extraktion);
  const underlag = {
    betyg: "C" as const,
    klampadFran: "A" as const,
    avvikandeSiffror: ["6 759 091 kr", "87 %"],
    fasta,
    rodaFlaggor: [
      { titel: "Lånen omsätts", beskrivning: "Stor del förfaller.", severity: "hog" as const },
    ],
    tidigareMotivering: "Tidigare text.",
  };

  it("systemprompten fastslår betyget, förbjuder egna tal och kräver bara JSON", () => {
    const p = buildMotiveringSystemPrompt();
    expect(p).toMatch(/Betyget är redan fastställt/);
    expect(p).toMatch(/Argumentera aldrig för ett annat betyg/);
    expect(p).toMatch(/Räkna aldrig själv/);
    expect(p).toContain('{ "betygMotivering"');
    expect(p).toMatch(/Svara ENDAST med detta enda JSON-objekt/);
  });

  it("användarprompten bär betyget, orsakerna, de fasta värdena, flaggorna och den tidigare texten", () => {
    const u = buildMotiveringUserPrompt(underlag);
    expect(u).toContain("Fastställt betyg: C");
    expect(u).toContain("Det första förslaget var betyget A");
    expect(u).toContain("6 759 091 kr; 87 %");
    expect(u).toContain("## Fasta värden");
    expect(u).toContain('status "kritisk"');
    expect(u).toContain('Lånen omsätts (severity "hog"): Stor del förfaller.');
    expect(u).toContain("Tidigare text.");
  });

  it("utelämnar orsaker som inte gäller, och hanterar noll röda flaggor", () => {
    const u = buildMotiveringUserPrompt({
      ...underlag,
      klampadFran: undefined,
      avvikandeSiffror: [],
      rodaFlaggor: [],
    });
    expect(u).not.toContain("Det första förslaget var betyget");
    expect(u).not.toContain("stämde inte med underlaget");
    expect(u).toContain("(ingen angiven orsak)");
    expect(u).toContain("(inga röda flaggor)");
  });
});

describe("buildTranskriberingSystemPrompt", () => {
  it("kräver ordagrann avskrift med originalsidnummer och att textlagret aldrig ska litas på", () => {
    const p = buildTranskriberingSystemPrompt();
    expect(p).toMatch(/=== SIDA n ===/);
    expect(p).toMatch(/Förlita dig ALDRIG på textlagret/);
  });
});

describe("PROMPT_VERSION", () => {
  it("exporteras som en icke-tom sträng", () => {
    expect(typeof PROMPT_VERSION).toBe("string");
    expect(PROMPT_VERSION.length).toBeGreaterThan(0);
  });

  it("är 9 sedan extraktionen fick lån per rad, balansdag, räntekostnader, underhållsbelopp, lokaler och energiprojekt (8: frågor med varför, betygsband, fasta värden)", () => {
    expect(PROMPT_VERSION).toBe("9");
  });

  // Denna hash låser exakt texten i samtliga promptbyggare. Har du ändrat en
  // prompt med avsikt: höj PROMPT_VERSION i prompts.ts OCH uppdatera hashen
  // nedan så att den stämmer med den nya texten — en avsiktlig redigering är
  // inte samma sak som ett misstag, men båda ska tvinga cachen att missa.
  it("larmar om någon promptbyggares utdata ändras utan att PROMPT_VERSION höjs", () => {
    const allaPrompter = [
      buildGroundingSystemPrompt(),
      buildGroundingUserPrompt(),
      buildExtractionSystemPrompt(),
      buildExtractionUserPrompt(""),
      buildAnalysSystemPrompt(),
      buildAnalysUserPrompt(extraktion, new Set()),
      buildMotiveringSystemPrompt(),
      buildMotiveringUserPrompt({
        betyg: "C",
        klampadFran: "A",
        avvikandeSiffror: ["6 759 091 kr"],
        fasta: beraknaFastaVarden(extraktion),
        rodaFlaggor: [{ titel: "Titel", beskrivning: "Beskrivning.", severity: "hog" }],
        tidigareMotivering: "Tidigare motivering.",
      }),
      buildTranskriberingSystemPrompt(),
      buildTranskriberingUserPrompt(6, 5),
    ].join("");

    const hash = createHash("sha256").update(allaPrompter).digest("hex");

    expect(hash).toBe("015765ab5ef3f04b2ba3e1753eddd32c6afa68dfa6214ba795d40e17cca21326");
  });
});

describe("TRANSKRIPTION_PROMPT_VERSION", () => {
  // Sparade sidor återanvänds bara om de skrevs med samma transkriptionsprompt.
  // Ändrar du medvetet transkriptionsprompten: höj TRANSKRIPTION_PROMPT_VERSION
  // i prompts.ts OCH lägg till den nya versionens hash här (behåll de gamla).
  const HASHAR: Record<string, string> = {
    "1": "a25895199cf34c44a600920f56674dce0b73e6a731fee4bc5ddb24200d47281e",
  };

  it("är en icke-tom sträng med en känd hash", () => {
    expect(TRANSKRIPTION_PROMPT_VERSION.length).toBeGreaterThan(0);
    expect(HASHAR[TRANSKRIPTION_PROMPT_VERSION]).toBeDefined();
  });

  it("larmar om transkriptionsprompten ändras utan att TRANSKRIPTION_PROMPT_VERSION höjs", () => {
    const utdata = [
      buildTranskriberingSystemPrompt(),
      buildTranskriberingUserPrompt(6, 5),
      buildTranskriberingUserPrompt(1, 1),
    ].join("\n---\n");
    const hash = createHash("sha256").update(utdata).digest("hex");
    expect(hash).toBe(HASHAR[TRANSKRIPTION_PROMPT_VERSION]);
  });
});
