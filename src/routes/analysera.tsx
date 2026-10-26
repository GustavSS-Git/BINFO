import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card, Button, Callout, Field, TristateChoice, PageHeader } from "@/components/ui/binfo";
import { Prisrimlighet } from "@/components/AnalysRapport";
import { SparadVardering } from "@/components/analysera/SparadVardering";
import { InfoRuta, FelRuta } from "@/components/konto/AuthSida";
import { SparaKnapp } from "@/components/konto/SparaKnapp";
import { useAterstallUtkast } from "@/components/konto/useAterstallUtkast";
import { useUppgifter, setUppgifter, lasUppgifter } from "@/lib/uppgifter";
import {
  buildPropertyInput,
  formateraFilstorlek,
  harValideringsfel,
  filfelVidSkick,
  parseForeningSlug,
  kontrolleraPdfFil,
  validateraAnalyseraForm,
  type AnalyseraFormFields,
} from "@/lib/analyseraForm";
import {
  buildPrisInput,
  harVarderingsfel,
  parseAnalyseraPrefill,
  tillVarderingForm,
  validateraVarderingForm,
  type AnalyseraPrefill,
  type VarderingFormFields,
} from "@/lib/varderingForm";
import {
  hamtaAnnonsFn,
  hamtaPostnummerInfoFn,
  hamtaPrisuppskattningFn,
  hamtaRegisterForeningFn,
  sparaVarderingFn,
  skapaAnalysFn,
  skapaAnalysFranRegisterFn,
} from "@/server/analysFn";
import { kontrolleraAnnonsUrl } from "@/lib/annons/url";
import {
  annonsFaltVisning,
  annonsTristateText,
  boareaTillTal,
  foreningsHint,
  hamtaAnnonsUppgifter,
  markeraAndrad,
  tillAnnonsKalla,
  tillampaAnnons,
  type AnnonsFormLage,
} from "@/lib/annons/formular";
import { postnummerFaltVisning } from "@/lib/postnummer/falt";
import {
  POSTNORD_POSTNUMMER_URL,
  postnummerSiffror,
  type PostnummerInfo,
} from "@/lib/postnummer/typer";
import { formatSkapadDatum } from "@/lib/analysisView";
import { MAX_ETIKETT_TECKEN } from "@/lib/kontoTyper";
import { inloggningsSok, parseSparaSok, type SparaSok } from "@/lib/till";
import { VarderingUtkastSchema, skrivUtkast, type VarderingUtkast } from "@/lib/utkast";
import type { RegisterForeningVy } from "@/lib/registerVy";
import { FELKOD_INNEHALL, type AnalysErrorCode } from "@/lib/analysStatusCopy";
import {
  sparaAnalys,
  hamtaSenasteAnalyser,
  glomAnalys,
  type SenasteAnalys,
} from "@/lib/senasteAnalyser";
import type { PrisInput, PrisuppskattningResultat } from "@/types/analysis";

type AnalyseraSearch = AnalyseraPrefill & SparaSok & { forening?: string | undefined };

/**
 * Visar rutan "Dina senaste analyser" (webbläsarens localStorage-lista, se
 * src/lib/senasteAnalyser.ts). Dold tills vidare (ägarbeslut 2026-10-23):
 * listan fortsätter att sparas i bakgrunden (sparaAnalys anropas som förut)
 * och kontohistoriken på /konto påverkas inte. Sätt till `true` för att visa
 * rutan igen.
 */
export const VISA_SENASTE_ANALYSER = false;

export const Route = createFileRoute("/analysera")({
  head: () => ({
    meta: [
      { title: "Analysera en bostad — Binfo" },
      {
        name: "description",
        content:
          "Gratis priskoll direkt, utan uppladdning. Vill du också granska föreningen laddar du upp årsredovisningen och får riskbetyg, nyckeltal och räntestress.",
      },
      { property: "og:title", content: "Analysera en bostad — Binfo" },
      {
        property: "og:description",
        content:
          "Gratis priskoll direkt. Ladda upp årsredovisningen för en valfri BRF-analys med riskbetyg och räntestress.",
      },
    ],
  }),
  // Valfri förifyllning (äldre länkar, bara textfälten), `forening=<slug>` från
  // BRF-registret (årsredovisningen finns redan), `sparad=<id>` (öppna en sparad
  // värdering) och `spara=` (slutför ett väntande Spara efter inloggning).
  validateSearch: (search: Record<string, unknown>): AnalyseraSearch => ({
    ...parseAnalyseraPrefill(search),
    forening: parseForeningSlug(search["forening"]),
    ...parseSparaSok(search),
  }),
  component: AnalyseraSida,
});

const TOM_FORM: AnalyseraFormFields = {
  utgangspris: "",
  boarea: "",
  vaning: "",
  manadsavgift: "",
  andelstal: "",
  organisationsnummer: "",
  adress: "",
  postnummer: "",
  antalRum: "",
  byggar: "",
};

/** Ett skickat-fel som INTE navigerar bort — antingen ett synkront `ok: false`
 *  från skapaAnalysFn (t.ex. scanned_pdf, innan något jobb skapats), eller ett
 *  kastat nätverks-/serverfel. Skiljs åt bara för att visa rätt hjälptext. */
type SkickaFel =
  { typ: "kand"; errorCode: AnalysErrorCode; errorMessage: string } | { typ: "okand" };

/** Föreningen bakom `?forening=`: laddar, hittad (årsredovisningen finns i
 *  registret), eller inte hittad/ej hämtningsbar (vanlig uppladdning). */
type ForeningLage =
  | { typ: "ingen" }
  | { typ: "laddar" }
  | { typ: "hittad"; vy: RegisterForeningVy }
  | { typ: "saknas"; orsak: "saknas" | "fel" };

function useRegisterForening(slug: string | undefined): ForeningLage {
  const [lage, setLage] = useState<ForeningLage>(slug ? { typ: "laddar" } : { typ: "ingen" });
  useEffect(() => {
    if (!slug) {
      setLage({ typ: "ingen" });
      return;
    }
    let avbruten = false;
    setLage({ typ: "laddar" });
    (async () => {
      try {
        let svar = await hamtaRegisterForeningFn({ data: { slug } });
        // Ett gammalt slug (föreningen bytte namn): följ till det nya, en gång.
        if (svar.status === "omdirigera") {
          svar = await hamtaRegisterForeningFn({ data: { slug: svar.slug } });
        }
        if (avbruten) return;
        if (svar.status === "ok") setLage({ typ: "hittad", vy: svar.forening });
        else setLage({ typ: "saknas", orsak: svar.status === "saknas" ? "saknas" : "fel" });
      } catch (fel) {
        console.error("[analysera] hamtaRegisterForeningFn kastade:", fel);
        if (!avbruten) setLage({ typ: "saknas", orsak: "fel" });
      }
    })();
    return () => {
      avbruten = true;
    };
  }, [slug]);
  return lage;
}

/** Samma förifyllning men utan `forening`: länken "Ladda upp en annan". */
function utanForening(s: AnalyseraSearch): AnalyseraPrefill {
  return {
    utgangspris: s.utgangspris,
    boarea: s.boarea,
    antalRum: s.antalRum,
    manadsavgift: s.manadsavgift,
    postnummer: s.postnummer,
    vaning: s.vaning,
    byggar: s.byggar,
  };
}

/** Priskollens (steg 1) utfall: ett lyckat svar eller ett fel att visa ordagrant.
 *  `serverfel` är ett kastat nätverks-/serverfel (inget köparsäkert meddelande). */
type PrisUtfall =
  | { typ: "ok"; resultat: PrisuppskattningResultat; skickatFormular: VarderingFormFields }
  | { typ: "fel"; errorMessage: string }
  | { typ: "serverfel" };

/** `?sparad=<id>` visar en sparad värdering i stället för de två stegen. */
function AnalyseraSida() {
  const { sparad } = Route.useSearch();
  return sparad !== undefined ? <SparadVardering id={sparad} /> : <Analysera />;
}

function Analysera() {
  const navigate = useNavigate();
  const prefill = Route.useSearch();
  // Husstödet finns kvar i den bakomliggande mappningen, men Analysera är
  // tills vidare grafiskt och funktionellt låst till bostadsrätter.
  const typ = "brf" as const;
  const [dragging, setDragging] = useState(false);
  const [fil, setFil] = useState<File | null>(null);
  const [filFel, setFilFel] = useState<string | null>(null);
  const [visaFilFel, setVisaFilFel] = useState(false);
  // Två flaggor: priskollen (steg 1) ska inte markera adress som fel.
  const [visaFelSteg1, setVisaFelSteg1] = useState(false);
  const [visaFelSteg2, setVisaFelSteg2] = useState(false);
  const [skickar, setSkickar] = useState(false);
  const [skickaFel, setSkickaFel] = useState<SkickaFel | null>(null);
  const [varderar, setVarderar] = useState(false);
  const [prisUtfall, setPrisUtfall] = useState<PrisUtfall | null>(null);
  const [etikett, setEtikett] = useState("");
  // Hämta uppgifter från en annons: länktext, pågående hämtning, fel under fältet och
  // varifrån varje fält kommer (null = ingen hämtning gjord).
  const [annonsLank, setAnnonsLank] = useState("");
  const [hamtarAnnons, setHamtarAnnons] = useState(false);
  const [annonsFel, setAnnonsFel] = useState<string | null>(null);
  const [annonsLage, setAnnonsLage] = useState<AnnonsFormLage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const foreningLage = useRegisterForening(prefill.forening);
  // Läget "årsredovisningen finns redan": ingen PDF, bara objektets uppgifter.
  const franRegister = foreningLage.typ === "hittad" ? foreningLage.vy : null;

  const [form, setForm] = useState<AnalyseraFormFields>(() => ({
    ...TOM_FORM,
    ...(prefill.utgangspris ? { utgangspris: prefill.utgangspris } : {}),
    ...(prefill.boarea ? { boarea: prefill.boarea } : {}),
    ...(prefill.antalRum ? { antalRum: prefill.antalRum } : {}),
    ...(prefill.manadsavgift ? { manadsavgift: prefill.manadsavgift } : {}),
    ...(prefill.postnummer ? { postnummer: prefill.postnummer } : {}),
    ...(prefill.vaning ? { vaning: prefill.vaning } : {}),
    ...(prefill.byggar ? { byggar: prefill.byggar } : {}),
  }));
  const uppgifter = useUppgifter();
  // Senaste formulär och annonsläge, för svaret på en hämtning som kan ha tagit en stund:
  // det som köparen ändrat under tiden ska räknas som hens eget.
  const formRef = useRef(form);
  const annonsLageRef = useRef(annonsLage);
  formRef.current = form;
  annonsLageRef.current = annonsLage;

  // Klick på säkerhetsmätaren i rapporten länkar hit med #vet-ej.
  useEffect(() => {
    if (window.location.hash === "#vet-ej") {
      document.getElementById("vet-ej")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    // Ett ändrat annonsfält är inte längre "hämtat från Booli".
    setAnnonsLage((l) => (l ? markeraAndrad(l, k) : l));
  };

  // Områdestext under postnummerfältet (bara på klienten).
  const [postnummerInfo, setPostnummerInfo] = useState<PostnummerInfo | null>(null);
  const postnummerSif = postnummerSiffror(form.postnummer);
  useEffect(() => {
    if (postnummerSif === null) {
      setPostnummerInfo(null);
      return;
    }
    let aktuell = true; // ignorera inaktuella svar
    const timer = setTimeout(() => {
      hamtaPostnummerInfoFn({ data: { postnummer: postnummerSif } })
        .then((info) => {
          if (aktuell) setPostnummerInfo(info);
        })
        .catch((e: unknown) => {
          console.error("Postnummerinfo kunde inte hämtas", e);
          if (aktuell) setPostnummerInfo(null);
        });
    }, 250);
    return () => {
      aktuell = false;
      clearTimeout(timer);
    };
  }, [postnummerSif]);

  const annonsVisning = (falt: Parameters<typeof annonsFaltVisning>[1], varde: string) =>
    annonsFaltVisning(annonsLage, falt, varde);

  /** Hämtar annonsen och fyller i formuläret. Startar ALDRIG en värdering eller analys. */
  const hamtaFranAnnons = async () => {
    if (hamtarAnnons) return; // förhindra dubbelhämtning
    setHamtarAnnons(true);
    setAnnonsFel(null);
    try {
      const utfall = await hamtaAnnonsUppgifter(annonsLank, {
        kontrollera: kontrolleraAnnonsUrl,
        hamta: (url) => hamtaAnnonsFn({ data: { url } }),
      });
      if (utfall.typ === "fel") {
        setAnnonsFel(utfall.meddelande);
        return;
      }
      // Allt räknas från nuvarande läge (inte klickögonblickets): hiss/balkong direkt ur
      // butiken, ursprunget ur senaste annonsläget. Själva formuläret uppdateras med en
      // funktion så att tecken som skrivits under hämtningen inte skrivs över.
      const fore = annonsLageRef.current;
      const nuvarande = lasUppgifter();
      const tristates = { hiss: nuvarande.hiss, balkong: nuvarande.balkong };
      const svar = utfall.svar;
      const ny = tillampaAnnons(formRef.current, tristates, svar, fore);
      setForm((f) => tillampaAnnons(f, tristates, svar, fore).form);
      setUppgifter({
        hiss: ny.hiss,
        balkong: ny.balkong,
        ...(svar.uppgifter.boarea !== undefined || ny.form.boarea !== formRef.current.boarea
          ? { boarea: boareaTillTal(ny.form.boarea) }
          : {}),
      });
      annonsLageRef.current = ny.lage;
      setAnnonsLage(ny.lage);
    } finally {
      setHamtarAnnons(false);
    }
  };

  // Steg 1 (priskoll) och hela formuläret (steg 2) delar fältreglerna.
  const fel1 = validateraVarderingForm(tillVarderingForm(form));
  const harFel1 = harVarderingsfel(fel1);
  const fel = validateraAnalyseraForm(form);
  const harFel = harValideringsfel(fel);

  /** Kör värderingen för ett redan byggt underlag och visar resultatet. */
  const varderaOchVisa = async (input: PrisInput, skickatFormular: VarderingFormFields) => {
    setVarderar(true);
    setPrisUtfall(null);
    try {
      const svar = await hamtaPrisuppskattningFn({ data: input });
      if (svar.ok) {
        setPrisUtfall({ typ: "ok", resultat: svar.resultat, skickatFormular });
      } else {
        // Serverns meddelande är köparsäkert och visas ordagrant (även vid
        // validation/kvot/behorighet).
        setPrisUtfall({ typ: "fel", errorMessage: svar.errorMessage });
      }
    } catch (error) {
      console.error("[analysera] hamtaPrisuppskattningFn kastade:", error);
      setPrisUtfall({ typ: "serverfel" });
    } finally {
      setVarderar(false);
    }
  };

  const seVarderingen = async () => {
    if (varderar) return; // förhindra dubbelskick
    if (harFel1) {
      setVisaFelSteg1(true);
      return;
    }
    const input = buildPrisInput(tillVarderingForm(form), {
      hiss: uppgifter.hiss,
      balkong: uppgifter.balkong,
    });
    await varderaOchVisa(input, tillVarderingForm(form));
  };

  const sparaStatus = useAterstallUtkast<VarderingUtkast>({
    typ: "vardering",
    spara: prefill.spara,
    schema: VarderingUtkastSchema,
    rensaParam: () =>
      void navigate({
        to: "/analysera",
        search: {},
        replace: true,
      }),
    aterstall: async (utkast) => {
      setForm((f) => ({ ...f, ...utkast.form }));
      setEtikett(utkast.etikett);
      setUppgifter({ hiss: utkast.hiss, balkong: utkast.balkong });
      if (harVarderingsfel(validateraVarderingForm(utkast.form))) {
        setVisaFelSteg1(true);
        return { ok: false, meddelande: "Uppgifterna du fyllde i är inte kompletta längre." };
      }
      const input = buildPrisInput(utkast.form, { hiss: utkast.hiss, balkong: utkast.balkong });
      const etikettText = utkast.etikett.trim();
      const svar = await sparaVarderingFn({
        data: { prisInput: input, ...(etikettText !== "" ? { etikett: etikettText } : {}) },
      });
      void varderaOchVisa(input, utkast.form);
      return svar.ok ? { ok: true } : svar;
    },
  });

  const valjFil = (candidate: File | undefined | null) => {
    if (!candidate) return;
    setSkickaFel(null);
    const fel = kontrolleraPdfFil(candidate);
    setFilFel(fel);
    setFil(fel ? null : candidate);
    // Visa skälet direkt — annars ser användaren inte varför filen inte togs emot.
    if (fel) setVisaFilFel(true);
  };

  const taBortFil = () => {
    setFil(null);
    setFilFel(null);
    setVisaFilFel(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const analysera = async () => {
    if (skickar) return; // förhindra dubbelskick

    const filfelNu = franRegister ? null : filfelVidSkick(fil, filFel);
    setFilFel(filfelNu);

    if (harFel || filfelNu) {
      setVisaFelSteg1(true);
      setVisaFelSteg2(true);
      return;
    }

    // fil är garanterat non-null här: kontrolleraPdfFil(null) returnerar alltid ett fel.
    const propertyInput = buildPropertyInput(
      typ,
      form,
      {
        hiss: uppgifter.hiss,
        balkong: uppgifter.balkong,
        avgiftInkluderar: uppgifter.ingar,
        antalPersoner: uppgifter.antalPersoner,
      },
      annonsLage ? tillAnnonsKalla(annonsLage) : undefined,
    );

    setSkickar(true);
    setSkickaFel(null);
    try {
      let resultat;
      if (franRegister) {
        resultat = await skapaAnalysFranRegisterFn({
          data: { slug: franRegister.slug, propertyInput },
        });
      } else {
        const formData = new FormData();
        formData.set("pdf", fil as File);
        formData.set("propertyInput", JSON.stringify(propertyInput));
        resultat = await skapaAnalysFn({ data: formData });
      }
      if (resultat.ok) {
        // Föreningens namn är inte känt än här (svaret ger bara ett id) —
        // förhandsvisnings-/rapportsidan fyller i det när den läser
        // analysen (se sparaAnalys-anropen där). Utan det här anropet
        // skulle en analys som aldrig hinner klart innan användaren
        // navigerar bort inte synas i listan alls.
        sparaAnalys({ analysisId: resultat.analysisId, skapad: new Date().toISOString() });
        navigate({
          to: "/forhandsvisning/$analysisId",
          params: { analysisId: resultat.analysisId },
        });
        return;
      }
      setSkickaFel({
        typ: "kand",
        errorCode: resultat.errorCode,
        errorMessage: resultat.errorMessage,
      });
    } catch (fel) {
      // Köparen får en generisk text, men orsaken ska aldrig försvinna tyst —
      // ett nätverksfel eller en 500:a här är exakt det man vill kunna se i
      // konsolen när någon rapporterar "det gick inte att skicka in".
      console.error("[analysera] skapa analys kastade:", fel);
      setSkickaFel({ typ: "okand" });
    } finally {
      setSkickar(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader
        eyebrow="Gratis priskoll · valfri BRF-analys"
        title="Analysera en bostad"
        lead={
          franRegister
            ? "Börja med en gratis priskoll. Föreningens årsredovisning har vi redan, så för BRF-analysen i steg 2 behöver du bara lägga till adressen — uppgifterna du redan fyllt i följer med."
            : "Börja med en gratis priskoll. Vill du granska föreningen också laddar du upp årsredovisningen i steg 2 — uppgifterna du redan fyllt i följer med."
        }
      />

      <SenasteAnalyserSektion />

      {sparaStatus.typ === "kraver_inloggning" ? (
        <div className="mb-6">
          <Callout variant="tip" title="Logga in för att spara">
            <p>
              Du behöver vara inloggad för att slutföra sparandet.{" "}
              <Link
                to="/konto/logga-in"
                search={inloggningsSok("/analysera", "vardering")}
                className="font-medium text-primary underline underline-offset-2"
              >
                Logga in
              </Link>
            </p>
          </Callout>
        </div>
      ) : null}
      {sparaStatus.typ === "saknas" ? (
        <div className="mb-6">
          <Callout variant="tip" title="Utkastet finns inte kvar">
            <p>
              Uppgifterna du fyllde i före inloggningen hittades inte (de sparas högst ett dygn, och
              bara i den här webbläsaren). Fyll i dem igen och tryck på Spara.
            </p>
          </Callout>
        </div>
      ) : null}
      {sparaStatus.typ === "sparar" ? (
        <div className="mb-6">
          <InfoRuta>
            <p>Sparar din värdering…</p>
          </InfoRuta>
        </div>
      ) : null}
      {sparaStatus.typ === "sparad" ? (
        <div className="mb-6">
          <InfoRuta>
            <p className="font-medium">Din värdering är sparad i ditt konto.</p>
            <p>
              <Link to="/konto" className="font-medium text-primary underline underline-offset-2">
                Se den i Mitt konto
              </Link>
            </p>
          </InfoRuta>
        </div>
      ) : null}
      {sparaStatus.typ === "fel" ? (
        <div className="mb-6">
          <FelRuta>Värderingen kunde inte sparas: {sparaStatus.meddelande}</FelRuta>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Hämta uppgifter från en Booli-annons (fyller bara i formuläret)    */}
      {/* ---------------------------------------------------------------- */}
      <Card className="mb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void hamtaFranAnnons();
          }}
        >
          <Field
            id="booli-lank"
            label="Klistra in länk från Booli"
            optional
            type="text"
            placeholder="https://www.booli.se/annons/…"
            value={annonsLank}
            onChange={(v) => {
              setAnnonsLank(v);
              setAnnonsFel(null);
            }}
            hint={
              annonsLage
                ? "Uppgifterna är ifyllda nedan. Kontrollera dem innan du går vidare."
                : "Vi fyller i uppgifterna från annonsen. Kontrollera dem innan du går vidare."
            }
            error={annonsFel}
          />
          <div className="mt-4">
            <Button type="submit" disabled={hamtarAnnons}>
              {hamtarAnnons ? "Hämtar…" : "Hämta uppgifter"}
            </Button>
          </div>
        </form>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Steg 1: Priskoll (gratis, ingen uppladdning)                      */}
      {/* ---------------------------------------------------------------- */}
      <Card>
        <h2 className="font-display text-2xl text-foreground">Steg 1: Priskoll</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Gratis och direkt, ingen uppladdning. Utgångspriset är valfritt — fyller du i det jämförs
          det med värderingen.
        </p>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Field
            id="falt-boarea"
            label="Boarea"
            type="text"
            suffix="m²"
            placeholder="58"
            value={form.boarea}
            onChange={(v) => {
              set("boarea")(v);
              setUppgifter({ boarea: boareaTillTal(v) });
            }}
            error={visaFelSteg1 ? fel1.boarea : null}
            {...annonsVisning("boarea", form.boarea)}
          />
          <Field
            id="falt-antalRum"
            label="Antal rum"
            type="text"
            placeholder="3"
            value={form.antalRum}
            onChange={set("antalRum")}
            error={visaFelSteg1 ? fel1.antalRum : null}
            {...annonsVisning("antalRum", form.antalRum)}
          />
          <Field
            id="falt-manadsavgift"
            label="Månadsavgift"
            type="text"
            suffix="kr/mån"
            placeholder="3 240"
            value={form.manadsavgift}
            onChange={set("manadsavgift")}
            error={visaFelSteg1 ? fel1.manadsavgift : null}
            {...annonsVisning("manadsavgift", form.manadsavgift)}
          />
          <div>
            <Field
              id="falt-postnummer"
              label="Postnummer"
              type="text"
              placeholder="116 25"
              value={form.postnummer}
              onChange={set("postnummer")}
              error={visaFelSteg1 ? fel1.postnummer : null}
              {...postnummerFaltVisning({
                // Bara svaret för det postnummer som står i fältet nu.
                info:
                  postnummerInfo !== null &&
                  postnummerInfo.status !== "ogiltig" &&
                  postnummerInfo.postnummer === postnummerSif
                    ? postnummerInfo
                    : null,
                annons: annonsVisning("postnummer", form.postnummer),
              })}
            />
            <a
              href={POSTNORD_POSTNUMMER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Vet du inte postnumret? Sök hos PostNord
            </a>
          </div>
          <Field
            id="falt-vaning"
            label="Våning"
            placeholder="4"
            value={form.vaning}
            onChange={set("vaning")}
            error={visaFelSteg1 ? fel1.vaning : null}
            {...annonsVisning("vaning", form.vaning)}
          />
          <Field
            id="falt-byggar"
            label="Byggår"
            optional
            placeholder="1931"
            value={form.byggar}
            onChange={set("byggar")}
            {...annonsVisning("byggar", form.byggar)}
          />
          <Field
            id="falt-utgangspris"
            label="Utgångspris"
            optional
            type="text"
            suffix="kr"
            placeholder="4 950 000"
            value={form.utgangspris}
            onChange={set("utgangspris")}
            error={visaFelSteg1 ? fel1.utgangspris : null}
            {...annonsVisning("utgangspris", form.utgangspris)}
          />
        </div>

        <div id="vet-ej" className="mt-8 scroll-mt-24 grid gap-6 md:grid-cols-2">
          <div>
            <span className="mb-2 block text-sm font-medium text-foreground">
              Hiss{" "}
              <span className="ml-1 text-xs font-normal text-muted-foreground">(valfritt)</span>
              {annonsTristateText(annonsLage, "hiss", uppgifter.hiss) ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {annonsTristateText(annonsLage, "hiss", uppgifter.hiss)}
                </span>
              ) : null}
            </span>
            <TristateChoice
              value={uppgifter.hiss}
              onChange={(v) => {
                setUppgifter({ hiss: v });
                setAnnonsLage((l) => (l ? markeraAndrad(l, "hiss") : l));
              }}
            />
          </div>
          <div>
            <span className="mb-2 block text-sm font-medium text-foreground">
              Balkong{" "}
              <span className="ml-1 text-xs font-normal text-muted-foreground">(valfritt)</span>
              {annonsTristateText(annonsLage, "balkong", uppgifter.balkong) ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {annonsTristateText(annonsLage, "balkong", uppgifter.balkong)}
                </span>
              ) : null}
            </span>
            <TristateChoice
              value={uppgifter.balkong}
              onChange={(v) => {
                setUppgifter({ balkong: v });
                setAnnonsLage((l) => (l ? markeraAndrad(l, "balkong") : l));
              }}
            />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={seVarderingen} disabled={varderar}>
            {varderar ? "Värderar…" : "Se värderingen"}
          </Button>
          <span className="text-sm text-muted-foreground">
            {visaFelSteg1 && harFel1
              ? "Fyll i de obligatoriska fälten."
              : "Ingen uppladdning behövs."}
          </span>
        </div>
      </Card>

      {prisUtfall?.typ === "fel" ? (
        <div className="mt-6 rounded-lg border border-danger/30 bg-danger/5 p-4" role="alert">
          <p className="font-medium text-foreground">Det gick inte att göra värderingen</p>
          <p className="mt-2 text-sm text-foreground">{prisUtfall.errorMessage}</p>
        </div>
      ) : null}

      {prisUtfall?.typ === "serverfel" ? (
        <div className="mt-6 rounded-lg border border-danger/30 bg-danger/5 p-4" role="alert">
          <p className="font-medium text-foreground">Det gick inte att göra värderingen</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Något gick fel. Försök igen om en stund.
          </p>
        </div>
      ) : null}

      {prisUtfall?.typ === "ok" ? (
        <div className="mt-10">
          <Prisrimlighet
            prisanalys={prisUtfall.resultat.prisanalys}
            boarea={prisUtfall.resultat.input.boarea}
          />

          {sparaStatus.typ === "sparad" ? null : (
            <Card className="mb-6">
              <h2 className="font-display text-2xl text-foreground">Spara värderingen</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Spara den i ditt konto för att hitta tillbaka till den och kunna räkna om den
                senare.
              </p>
              <div className="mt-4 max-w-sm">
                <Field
                  label="Namn"
                  optional
                  type="text"
                  placeholder="Till exempel adressen"
                  value={etikett}
                  onChange={(v) => setEtikett(v.slice(0, MAX_ETIKETT_TECKEN))}
                />
              </div>
              <div className="mt-5">
                <SparaKnapp
                  key={prisUtfall.resultat.skapad}
                  typ="vardering"
                  etikettKnapp="Spara värderingen"
                  till="/analysera"
                  spara={() => {
                    const e = etikett.trim();
                    return sparaVarderingFn({
                      data: {
                        prisInput: prisUtfall.resultat.input,
                        ...(e !== "" ? { etikett: e } : {}),
                      },
                    });
                  }}
                  forbered={() =>
                    skrivUtkast(
                      "vardering",
                      {
                        form: prisUtfall.skickatFormular,
                        hiss: prisUtfall.resultat.input.hiss,
                        balkong: prisUtfall.resultat.input.balkong,
                        etikett,
                      } satisfies VarderingUtkast,
                      "/analysera",
                    )
                  }
                />
              </div>
            </Card>
          )}

          <p className="text-sm text-muted-foreground">
            Vill du granska föreningen också? Fortsätt med steg 2 nedan — uppgifterna du fyllt i
            följer med.
          </p>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Steg 2: BRF-analys (valfritt)                                     */}
      {/* ---------------------------------------------------------------- */}
      <div className="mb-4 mt-12">
        <h2 className="font-display text-2xl text-foreground">
          Steg 2: Granska föreningen (valfritt)
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {franRegister
            ? "Du får de sju nyckeltalen, räntestresstest och frågor att ställa till styrelsen."
            : "Ladda upp föreningens senaste årsredovisning så får du de sju nyckeltalen, räntestresstest och frågor att ställa till styrelsen."}
        </p>
      </div>

      {foreningLage.typ === "laddar" ? (
        <Card className="mb-6" aria-busy="true">
          <p className="text-sm text-muted-foreground">Hämtar föreningen från registret…</p>
        </Card>
      ) : franRegister ? (
        <Card className="mb-6">
          <h3 className="font-display text-2xl text-foreground">
            Föreningens årsredovisning finns redan hos Binfo
          </h3>
          <p className="mt-2 text-sm text-foreground">
            <span className="font-medium">{franRegister.namn}</span> · räkenskapsår{" "}
            {franRegister.senaste.rakenskapsar} · analyserad{" "}
            {formatSkapadDatum(franRegister.senaste.analysdatum)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Du behöver bara fylla i lägenhetens uppgifter i steg 1 samt adressen nedan.
          </p>
          <p className="mt-3 text-sm">
            <Link
              to="/analysera"
              search={utanForening(prefill)}
              replace
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Ladda upp en annan årsredovisning i stället
            </Link>
          </p>
        </Card>
      ) : (
        <>
          {foreningLage.typ === "saknas" ? (
            <div className="mb-6">
              <Callout
                variant="flag"
                title={
                  foreningLage.orsak === "saknas"
                    ? "Vi hittade inte föreningen i registret"
                    : "Vi kunde inte hämta föreningen just nu"
                }
              >
                Ladda upp föreningens årsredovisning nedan i stället.
              </Callout>
            </div>
          ) : null}
          <Card className="mb-6">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => valjFil(e.target.files?.[0])}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                valjFil(e.dataTransfer.files?.[0]);
              }}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
                dragging ? "border-primary bg-primary/5" : "border-border bg-secondary/40"
              }`}
            >
              <p className="font-medium text-foreground">
                Dra och släpp årsredovisningen här, eller klicka för att välja fil
              </p>
              <p className="mt-1 text-sm text-muted-foreground">PDF, max 25 MB</p>
              {fil ? (
                <p className="mt-4 inline-flex items-center gap-3 rounded-full bg-card px-4 py-2 text-sm text-foreground">
                  <span className="size-2 rounded-full bg-success" />
                  {fil.name} ({formateraFilstorlek(fil.size)})
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      taBortFil();
                    }}
                    className="text-muted-foreground underline hover:text-foreground"
                  >
                    Ta bort
                  </button>
                </p>
              ) : null}
            </div>
            {(visaFelSteg2 || visaFilFel) && filFel ? (
              <p className="mt-3 text-sm text-danger">{filFel}</p>
            ) : null}
            {foreningsHint(annonsLage) ? (
              <p className="mt-3 text-sm text-muted-foreground">{foreningsHint(annonsLage)}</p>
            ) : null}
          </Card>
        </>
      )}

      <Card>
        <h3 className="font-display text-2xl text-foreground">Adress till objektet</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Resten av uppgifterna (boarea, våning, avgift med mera) tar vi från steg 1.
        </p>
        <div className="mt-6 grid gap-5">
          <Field
            id="falt-adress"
            label="Adress"
            type="text"
            placeholder="Kapellgränd 12"
            value={form.adress}
            onChange={set("adress")}
            error={visaFelSteg2 ? fel.adress : null}
            {...annonsVisning("adress", form.adress)}
          />
        </div>

        {skickaFel ? (
          <div className="mt-8 rounded-lg border border-danger/30 bg-danger/5 p-4">
            {skickaFel.typ === "kand" ? (
              <>
                <p className="font-medium text-foreground">
                  {FELKOD_INNEHALL[skickaFel.errorCode].rubrik}
                </p>
                <p className="mt-2 text-sm text-foreground">{skickaFel.errorMessage}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {FELKOD_INNEHALL[skickaFel.errorCode].atgard}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-foreground">Kunde inte skicka in analysen</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Något gick fel vid uppladdningen — kontrollera din internetuppkoppling och försök
                  igen.
                </p>
              </>
            )}
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={analysera} disabled={skickar || foreningLage.typ === "laddar"}>
            {skickar ? "Skickar in…" : "Analysera"}
          </Button>
          <span className="text-sm text-muted-foreground">
            {visaFelSteg2 && (harFel || filFel)
              ? "Fyll i de obligatoriska fälten, även i steg 1."
              : skickar
                ? franRegister
                  ? "Skapar din analys…"
                  : "Laddar upp och startar analysen…"
                : franRegister
                  ? "Föreningens analys finns redan — du får din rapport direkt."
                  : "Analysen tar några minuter — du följer den på nästa sida."}
          </span>
        </div>
      </Card>
    </div>
  );
}

/**
 * Genväg tillbaka till en redan skapad analys — annars finns ingen väg
 * tillbaka efter att ha lämnat förhandsvisningen/rapporten (t.ex. via
 * bolånekalkylen), eftersom "Analysera" i navet alltid pekar på det här
 * tomma formuläret. Listan kommer enbart från localStorage (se
 * src/lib/senasteAnalyser.ts) — ingen inloggning finns, så den är knuten
 * till just den här webbläsaren. Läses först i en effekt (inte vid render)
 * så SSR-svaret alltid är tomt/identiskt och aldrig gissar på klientens
 * lagring.
 */
function SenasteAnalyserSektion() {
  const [poster, setPoster] = useState<SenasteAnalys[]>([]);
  const [laddad, setLaddad] = useState(false);

  useEffect(() => {
    setPoster(hamtaSenasteAnalyser());
    setLaddad(true);
  }, []);

  const glom = (analysisId: string) => {
    glomAnalys(analysisId);
    setPoster(hamtaSenasteAnalyser());
  };

  if (!VISA_SENASTE_ANALYSER || !laddad || poster.length === 0) return null;

  return (
    <Card className="mb-6">
      <h2 className="text-base font-semibold text-foreground">Dina senaste analyser</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Sparas bara i den här webbläsaren och försvinner automatiskt efter 12 månader.
      </p>
      <ul className="mt-4 space-y-3">
        {poster.map((post) => (
          <li
            key={post.analysisId}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
          >
            <Link
              to="/analys/$analysisId"
              params={{ analysisId: post.analysisId }}
              className="text-sm font-medium text-primary underline underline-offset-2"
            >
              {post.foreningsnamn ?? "Analys utan namn ännu"}
            </Link>
            <button
              type="button"
              onClick={() => glom(post.analysisId)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Glöm
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
