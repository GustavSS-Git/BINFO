import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  Eyebrow,
  Field,
  IconChip,
  PageHeader,
  Stepper,
  TristateChoice,
} from "@/components/ui/binfo";
import { MedKontakt } from "@/components/AnalysStatus";
import { PriskollResultat } from "@/components/analysera/PriskollResultat";
import { SparadVardering } from "@/components/analysera/SparadVardering";
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
  annonsFaltMarkering,
  annonsResultatText,
  annonsTristateMarke,
  antalHamtade,
  boareaTillTal,
  foreningsHint,
  hamtaAnnonsUppgifter,
  markeraAndrad,
  tillAnnonsKalla,
  tillampaAnnons,
  type AnnonsFormLage,
  type AnnonsMarke,
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
          "Se vad bostaden är värd direkt, utan uppladdning. Vill du också granska föreningen laddar du upp årsredovisningen och får betyg, nyckeltal och räntestress.",
      },
      { property: "og:title", content: "Analysera en bostad — Binfo" },
      {
        property: "og:description",
        content:
          "Se vad bostaden är värd direkt. Ladda upp årsredovisningen för en BRF-analys med betyg och räntestress.",
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
  const [annonsAntal, setAnnonsAntal] = useState(0);
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

  const markeBadge = (m: AnnonsMarke | undefined) =>
    m ? <Badge tone={m.ton}>{m.text}</Badge> : undefined;
  /** Märke ("Från annonsen" …), hint och markering för ett textfält efter hämtning. */
  const annonsVisning = (falt: Parameters<typeof annonsFaltMarkering>[1], varde: string) => {
    const { marke, hint, framhav } = annonsFaltMarkering(annonsLage, falt, varde);
    return {
      ...(marke ? { badge: markeBadge(marke) } : {}),
      ...(hint !== undefined ? { hint } : {}),
      ...(framhav ? { framhav: true } : {}),
    };
  };
  /** Som annonsVisning men med en egen hint när annonsen inte har någon. */
  const medStandardHint = (
    falt: Parameters<typeof annonsFaltMarkering>[1],
    varde: string,
    standard: string,
  ) => {
    const v = annonsVisning(falt, varde);
    return { ...v, hint: v.hint ?? standard };
  };

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
      setAnnonsAntal(antalHamtade(ny.lage));
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
      const { adress: utkastAdress, ...utkastFalt } = utkast.form;
      setForm((f) => ({
        ...f,
        ...utkastFalt,
        ...(utkastAdress !== undefined ? { adress: utkastAdress } : {}),
      }));
      setEtikett(utkast.etikett);
      setUppgifter({ hiss: utkast.hiss, balkong: utkast.balkong });
      // Utkast från före redesign v4 bär inte adressen (och PrisInput gör det inte):
      // kräv den bara när utkastet har den.
      const utkastForm: VarderingFormFields = {
        ...utkastFalt,
        adress: utkastAdress ?? formRef.current.adress,
      };
      const utanAdress = utkastAdress === undefined;
      if (harVarderingsfel(validateraVarderingForm(utkastForm, { utanAdress }))) {
        setVisaFelSteg1(true);
        return { ok: false, meddelande: "Uppgifterna du fyllde i är inte kompletta längre." };
      }
      const input = buildPrisInput(utkastForm, { hiss: utkast.hiss, balkong: utkast.balkong });
      const etikettText = utkast.etikett.trim();
      const svar = await sparaVarderingFn({
        data: { prisInput: input, ...(etikettText !== "" ? { etikett: etikettText } : {}) },
      });
      void varderaOchVisa(input, utkastForm);
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

  const leadSteg1 = franRegister
    ? "Föreningens årsredovisning har vi redan hos Binfo. Fyll i bostadens uppgifter, så analyserar vi bostaden och föreningen på en gång. Vill du bara se vad bostaden är värd kan du göra det direkt efter steg 1."
    : "Fyll i bostadens uppgifter och ladda upp föreningens årsredovisning, så analyserar vi allt på en gång. Vill du bara se vad bostaden är värd kan du göra det direkt efter steg 1.";

  const hissMarke = annonsTristateMarke(annonsLage, "hiss", uppgifter.hiss);
  const balkongMarke = annonsTristateMarke(annonsLage, "balkong", uppgifter.balkong);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-8 md:py-14">
      <PageHeader
        eyebrow="Analysera en bostad"
        title="Vad är bostaden värd, och hur mår föreningen?"
        lead={leadSteg1}
      />
      <div className="mb-8">
        <Stepper
          steg={[
            { label: "Bostaden", lage: "aktuell" },
            { label: "Föreningen", lage: "kommande" },
            { label: "Rapport", lage: "kommande" },
          ]}
        />
      </div>

      <SenasteAnalyserSektion />

      {sparaStatus.typ === "kraver_inloggning" ? (
        <div className="mb-6">
          <Callout variant="tip" title="Logga in för att spara">
            <p>
              Du behöver vara inloggad för att slutföra sparandet.{" "}
              <Link
                to="/konto/logga-in"
                search={inloggningsSok("/analysera", "vardering")}
                className="font-medium text-link underline underline-offset-2"
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
        <div className="mb-6" role="status">
          <Callout variant="info" title="Sparar din värdering…">
            <p>Ett ögonblick.</p>
          </Callout>
        </div>
      ) : null}
      {sparaStatus.typ === "sparad" ? (
        <div className="mb-6" role="status">
          <Callout variant="info" title="Din värdering är sparad i ditt konto.">
            <p>
              <Link to="/konto" className="font-medium text-link underline underline-offset-2">
                Se den i Mitt konto
              </Link>
            </p>
          </Callout>
        </div>
      ) : null}
      {sparaStatus.typ === "fel" ? (
        <div className="mb-6" role="alert">
          <Callout variant="flag" title="Värderingen kunde inte sparas">
            <p>{sparaStatus.meddelande}</p>
          </Callout>
        </div>
      ) : null}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* ------------------------------------------------------------ */}
          {/* Hämta uppgifter från en Booli-annons (fyller bara i formuläret) */}
          {/* ------------------------------------------------------------ */}
          <Card>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void hamtaFranAnnons();
              }}
              className="flex flex-col gap-3"
            >
              <h2 className="text-lg font-semibold text-primary">Snabbast: hämta från annonsen</h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Field
                    id="booli-lank"
                    label="Länk från Booli"
                    type="text"
                    placeholder="https://www.booli.se/annons/…"
                    value={annonsLank}
                    onChange={(v) => {
                      setAnnonsLank(v);
                      setAnnonsFel(null);
                    }}
                  />
                </div>
                <Button type="submit" size="lg" disabled={hamtarAnnons}>
                  {hamtarAnnons ? "Hämtar…" : "Hämta uppgifter"}
                </Button>
              </div>
              {annonsFel ? (
                <p role="alert" className="text-sm text-danger-text">
                  {annonsFel}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground" role="status">
                  {annonsLage
                    ? annonsResultatText(annonsAntal)
                    : "Klistra in länken till annonsen så fyller vi i uppgifterna åt dig."}
                </p>
              )}
            </form>
          </Card>

          {/* ------------------------------------------------------------ */}
          {/* Steg 1: Om bostaden (Priskoll, ingen uppladdning)             */}
          {/* ------------------------------------------------------------ */}
          <Card className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <Eyebrow>Steg 1</Eyebrow>
              <h2 className="font-display text-[26px] font-semibold leading-[1.2] text-primary">
                Om bostaden
              </h2>
              <p className="text-base text-text-2">Det här behöver vi för värderingen.</p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field
                id="falt-adress"
                label="Adress"
                type="text"
                placeholder="Gatuadress och nummer"
                autoComplete="street-address"
                value={form.adress}
                onChange={set("adress")}
                error={visaFelSteg1 ? fel1.adress : null}
                {...annonsVisning("adress", form.adress)}
              />
              <div>
                <Field
                  id="falt-postnummer"
                  label="Postnummer"
                  type="text"
                  placeholder="t.ex. 112 46"
                  autoComplete="postal-code"
                  value={form.postnummer}
                  onChange={set("postnummer")}
                  error={visaFelSteg1 ? fel1.postnummer : null}
                  {...(() => {
                    const a = annonsVisning("postnummer", form.postnummer);
                    return {
                      ...(a.badge ? { badge: a.badge } : {}),
                      ...postnummerFaltVisning({
                        // Bara svaret för det postnummer som står i fältet nu.
                        info:
                          postnummerInfo !== null &&
                          postnummerInfo.status !== "ogiltig" &&
                          postnummerInfo.postnummer === postnummerSif
                            ? postnummerInfo
                            : null,
                        annons: {
                          ...(a.hint !== undefined ? { hint: a.hint } : {}),
                          ...(a.framhav ? { framhav: true } : {}),
                        },
                      }),
                    };
                  })()}
                />
                <a
                  href={POSTNORD_POSTNUMMER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm font-medium text-link underline underline-offset-2"
                >
                  Hitta postnummer
                </a>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <Field
                id="falt-boarea"
                label="Boarea"
                type="text"
                suffix="m²"
                placeholder="t.ex. 52"
                inputMode="decimal"
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
                placeholder="t.ex. 2"
                inputMode="decimal"
                value={form.antalRum}
                onChange={set("antalRum")}
                error={visaFelSteg1 ? fel1.antalRum : null}
                {...annonsVisning("antalRum", form.antalRum)}
              />
              <Field
                id="falt-vaning"
                label="Våning"
                type="text"
                placeholder="t.ex. 3"
                inputMode="numeric"
                value={form.vaning}
                onChange={set("vaning")}
                error={visaFelSteg1 ? fel1.vaning : null}
                {...annonsVisning("vaning", form.vaning)}
              />
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <Field
                id="falt-manadsavgift"
                label="Månadsavgift"
                type="text"
                suffix="kr/mån"
                placeholder="t.ex. 3 800"
                inputMode="numeric"
                value={form.manadsavgift}
                onChange={set("manadsavgift")}
                error={visaFelSteg1 ? fel1.manadsavgift : null}
                {...annonsVisning("manadsavgift", form.manadsavgift)}
              />
              <Field
                id="falt-byggar"
                label="Byggår"
                type="text"
                placeholder="t.ex. 1965"
                inputMode="numeric"
                value={form.byggar}
                onChange={set("byggar")}
                error={visaFelSteg1 ? fel1.byggar : null}
                {...annonsVisning("byggar", form.byggar)}
              />
              <Field
                id="falt-utgangspris"
                label="Utgångspris"
                type="text"
                suffix="kr"
                placeholder="t.ex. 4 500 000"
                inputMode="numeric"
                value={form.utgangspris}
                onChange={set("utgangspris")}
                error={visaFelSteg1 ? fel1.utgangspris : null}
                {...medStandardHint(
                  "utgangspris",
                  form.utgangspris,
                  "Fyller du i det jämför vi det med värderingen.",
                )}
              />
            </div>

            <div
              id="vet-ej"
              className="flex scroll-mt-24 flex-col gap-4 border-t border-divider pt-6"
            >
              <h3 className="text-base font-semibold text-primary">
                Fler uppgifter som ger en säkrare värdering
              </h3>
              <div className="grid gap-5 md:grid-cols-2">
                <fieldset className="m-0 min-w-0 border-0 p-0">
                  <legend className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 p-0 text-sm font-semibold text-foreground">
                    Hiss {markeBadge(hissMarke)}
                  </legend>
                  <TristateChoice
                    ariaLabel="Hiss"
                    value={uppgifter.hiss}
                    onChange={(v) => {
                      setUppgifter({ hiss: v });
                      setAnnonsLage((l) => (l ? markeraAndrad(l, "hiss") : l));
                    }}
                  />
                </fieldset>
                <fieldset className="m-0 min-w-0 border-0 p-0">
                  <legend className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 p-0 text-sm font-semibold text-foreground">
                    Balkong {markeBadge(balkongMarke)}
                  </legend>
                  <TristateChoice
                    ariaLabel="Balkong"
                    value={uppgifter.balkong}
                    onChange={(v) => {
                      setUppgifter({ balkong: v });
                      setAnnonsLage((l) => (l ? markeraAndrad(l, "balkong") : l));
                    }}
                  />
                </fieldset>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button size="lg" onClick={seVarderingen} disabled={varderar}>
                {varderar ? "Värderar…" : "Se värderingen utan hänsyn till föreningen"}
              </Button>
              <span className="text-sm text-muted-foreground">
                {visaFelSteg1 && harFel1
                  ? "Fyll i de obligatoriska fälten."
                  : "Tar några sekunder. Visas här nedanför."}
              </span>
            </div>
          </Card>

          {prisUtfall?.typ === "fel" ? (
            <div role="alert">
              <Callout variant="flag" title="Det gick inte att göra värderingen">
                <p>{prisUtfall.errorMessage}</p>
              </Callout>
            </div>
          ) : null}

          {prisUtfall?.typ === "serverfel" ? (
            <div role="alert">
              <Callout variant="flag" title="Det gick inte att göra värderingen">
                <p>Något gick fel. Försök igen om en stund.</p>
              </Callout>
            </div>
          ) : null}

          {prisUtfall?.typ === "ok" ? (
            <div className="flex flex-col gap-6">
              <PriskollResultat resultat={prisUtfall.resultat} />

              {sparaStatus.typ === "sparad" ? null : (
                <Card className="flex flex-col gap-4">
                  <h2 className="text-lg font-semibold text-primary">Spara värderingen</h2>
                  <p className="text-base text-text-2">
                    Spara den i ditt konto för att hitta tillbaka till den och kunna räkna om den
                    senare.
                  </p>
                  <div className="max-w-sm">
                    <Field
                      id="falt-etikett"
                      label="Namn"
                      type="text"
                      placeholder="Till exempel adressen"
                      hint="Lämnar du namnet tomt används adressen."
                      value={etikett}
                      onChange={(v) => setEtikett(v.slice(0, MAX_ETIKETT_TECKEN))}
                    />
                  </div>
                  <div>
                    <SparaKnapp
                      key={prisUtfall.resultat.skapad}
                      typ="vardering"
                      etikettKnapp="Spara värderingen"
                      till="/analysera"
                      spara={() => {
                        const e = valdEtikett(etikett, prisUtfall.skickatFormular.adress);
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
                            etikett: valdEtikett(etikett, prisUtfall.skickatFormular.adress),
                          } satisfies VarderingUtkast,
                          "/analysera",
                        )
                      }
                    />
                  </div>
                </Card>
              )}

              <p className="text-base text-text-2">
                Vill du granska föreningen också? Fortsätt med steg 2 nedan.
              </p>
            </div>
          ) : null}

          {/* ------------------------------------------------------------ */}
          {/* Steg 2: Granska föreningen                                    */}
          {/* ------------------------------------------------------------ */}
          <section id="steg2" className="flex scroll-mt-24 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Eyebrow>Steg 2</Eyebrow>
              <h2 className="font-display text-[26px] font-semibold leading-[1.2] text-primary">
                Granska föreningen
              </h2>
              <p className="text-base text-text-2">
                {franRegister
                  ? "Vi har föreningens årsredovisning redan, så du behöver inte ladda upp något."
                  : "Ladda upp föreningens senaste årsredovisning. Den får du av mäklaren eller styrelsen."}
              </p>
            </div>

            {foreningLage.typ === "laddar" ? (
              <Card>
                <div aria-busy="true">
                  <p className="text-base text-muted-foreground">
                    Hämtar föreningen från registret…
                  </p>
                </div>
              </Card>
            ) : franRegister ? (
              <Card className="flex flex-col gap-3">
                <h3 className="text-lg font-semibold text-primary">
                  Föreningens årsredovisning finns redan hos Binfo
                </h3>
                <p className="text-base text-foreground">
                  <span className="font-semibold">{franRegister.namn}</span> · räkenskapsår{" "}
                  {franRegister.senaste.rakenskapsar} · analyserad{" "}
                  {formatSkapadDatum(franRegister.senaste.analysdatum)}
                </p>
                <p className="text-base text-text-2">
                  Du behöver bara fylla i bostadens uppgifter i steg 1.
                </p>
                <p>
                  <Link
                    to="/analysera"
                    search={utanForening(prefill)}
                    replace
                    className="text-[15px] font-medium text-link underline underline-offset-2"
                  >
                    Ladda upp en annan årsredovisning i stället
                  </Link>
                </p>
              </Card>
            ) : (
              <>
                {foreningLage.typ === "saknas" ? (
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
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  aria-label="Välj årsredovisning (PDF)"
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
                  className={`flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                    dragging ? "border-primary bg-tint" : "border-input bg-card hover:bg-tint"
                  }`}
                >
                  <span className="text-base font-semibold text-primary">
                    Dra hit årsredovisningen, eller välj fil
                  </span>
                  <span className="text-sm text-muted-foreground">PDF, högst 25 MB</span>
                </div>
                {fil ? (
                  <p className="m-0 inline-flex w-fit max-w-full flex-wrap items-center gap-3 rounded-full bg-success-tint px-4 py-2 text-sm text-success-text">
                    <span className="break-all font-medium">
                      {fil.name} ({formateraFilstorlek(fil.size)})
                    </span>
                    <button
                      type="button"
                      onClick={taBortFil}
                      className="font-semibold underline underline-offset-2"
                    >
                      Ta bort
                    </button>
                  </p>
                ) : null}
                {(visaFelSteg2 || visaFilFel) && filFel ? (
                  <p role="alert" className="text-sm text-danger-text">
                    {filFel}
                  </p>
                ) : null}
                {foreningsHint(annonsLage) ? (
                  <p className="text-sm text-muted-foreground">{foreningsHint(annonsLage)}</p>
                ) : null}
              </>
            )}
          </section>

          {skickaFel ? (
            <div role="alert">
              {skickaFel.typ === "kand" ? (
                <Callout variant="flag" title={FELKOD_INNEHALL[skickaFel.errorCode].rubrik}>
                  <p>{skickaFel.errorMessage}</p>
                  <p>
                    <MedKontakt text={FELKOD_INNEHALL[skickaFel.errorCode].atgard} />
                  </p>
                </Callout>
              ) : (
                <Callout variant="flag" title="Kunde inte skicka in analysen">
                  <p>
                    Något gick fel vid uppladdningen — kontrollera din internetuppkoppling och
                    försök igen.
                  </p>
                </Callout>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              size="lg"
              onClick={analysera}
              disabled={skickar || foreningLage.typ === "laddar"}
            >
              {skickar
                ? "Skickar in…"
                : franRegister
                  ? "Analysera bostaden"
                  : "Analysera bostaden och föreningen"}
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
                    : "Tar några minuter. Du följer analysen på nästa sida."}
            </span>
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Sidoruta: vad du får, var årsredovisningen finns, integritet       */}
        {/* ---------------------------------------------------------------- */}
        <aside className="flex flex-col gap-5">
          <Card className="flex flex-col gap-5">
            <h2 className="text-lg font-semibold text-primary">Det här får du</h2>
            <FordelLista
              rubrik="Direkt, från bostadens uppgifter"
              rader={[
                ["kr", "Ett rimligt värdespann för bostaden"],
                ["↕", "Var utgångspriset ligger i spannet"],
                ["↑", "Vad budgivningar i området brukar landa på"],
              ]}
            />
            <hr className="m-0 border-0 border-t border-divider" />
            <FordelLista
              rubrik="Med årsredovisningen"
              rader={[
                ["A", "Betyg A–E på föreningens ekonomi"],
                ["7", "Sju nyckeltal, förklarade och bedömda"],
                ["kr", "Värdet med föreningens ekonomi inräknad"],
                ["+", "Väntad avgiftshöjning de närmaste två åren"],
                ["%", "Räntestress på just den här avgiften"],
                ["?", "Frågor till mäklaren och styrelsen, med bra svar och varningssignaler"],
                ["s.", "Sidhänvisning till årsredovisningen för varje siffra"],
              ]}
            />
            <Link
              to="/exempel"
              className="text-[15px] font-medium text-link underline underline-offset-2"
            >
              Se en exempelrapport →
            </Link>
          </Card>
          <Card className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-primary">Var hittar jag årsredovisningen?</h2>
            <p className="text-[15px] text-text-2">
              Årsredovisningen ligger nästan alltid under ”Dokument” i mäklarens egen annons för
              bostaden. Hittade du bostaden på Booli eller Hemnet, klicka på ”Läs mer hos mäklaren”
              för att komma dit.
            </p>
          </Card>
          <p className="text-sm text-muted-foreground">
            Priskollen sparas inte. Vid en analys sparar vi lägenhetsuppgifterna i 12 månader.{" "}
            <Link to="/integritet" className="font-medium text-link underline underline-offset-2">
              Integritet och personuppgifter
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}

/** Rubrik + rader med liten ikonruta (sidorutan "Det här får du"). */
function FordelLista({ rubrik, rader }: { rubrik: string; rader: [string, string][] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm font-semibold text-text-2">{rubrik}</p>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {rader.map(([tecken, text]) => (
          <li key={text} className="flex items-center gap-3 text-[15px] text-foreground">
            <IconChip>{tecken}</IconChip>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Namnet på en sparad värdering: det köparen skrev, annars adressen (ingen schemaändring). */
function valdEtikett(etikett: string, adress: string): string {
  const e = etikett.trim() || adress.trim();
  return e.slice(0, MAX_ETIKETT_TECKEN);
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
