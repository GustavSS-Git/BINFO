import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card, Button, Callout, Field, TristateChoice, PageHeader } from "@/components/ui/binfo";
import { useUppgifter, setUppgifter } from "@/lib/uppgifter";
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
import { parseAnalyseraPrefill, type AnalyseraPrefill } from "@/lib/varderingForm";
import {
  hamtaRegisterForeningFn,
  skapaAnalysFn,
  skapaAnalysFranRegisterFn,
} from "@/server/analysFn";
import { formatSkapadDatum } from "@/lib/analysisView";
import type { RegisterForeningVy } from "@/lib/registerVy";
import { FELKOD_INNEHALL, type AnalysErrorCode } from "@/lib/analysStatusCopy";
import {
  sparaAnalys,
  hamtaSenasteAnalyser,
  glomAnalys,
  type SenasteAnalys,
} from "@/lib/senasteAnalyser";

type AnalyseraSearch = AnalyseraPrefill & { forening?: string | undefined };

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
          "Ladda upp årsredovisningen och fyll i objektets uppgifter för att få din riskanalys.",
      },
      { property: "og:title", content: "Analysera en bostad — Binfo" },
      {
        property: "og:description",
        content: "Ladda upp årsredovisningen och få riskbetyg, prisbedömning och räntestress.",
      },
    ],
  }),
  // Valfri förifyllning från /vardering ("Bara priskoll") — bara textfälten —
  // samt `forening=<slug>` från BRF-registret (årsredovisningen finns redan).
  validateSearch: (search: Record<string, unknown>): AnalyseraSearch => ({
    ...parseAnalyseraPrefill(search),
    forening: parseForeningSlug(search["forening"]),
  }),
  component: Analysera,
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
  ort: "",
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
  const [visaFel, setVisaFel] = useState(false);
  const [skickar, setSkickar] = useState(false);
  const [skickaFel, setSkickaFel] = useState<SkickaFel | null>(null);
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

  // Klick på säkerhetsmätaren i rapporten länkar hit med #vet-ej.
  useEffect(() => {
    if (window.location.hash === "#vet-ej") {
      document.getElementById("vet-ej")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const fel = validateraAnalyseraForm(form);
  const harFel = harValideringsfel(fel);

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
      setVisaFel(true);
      return;
    }

    // fil är garanterat non-null här: kontrolleraPdfFil(null) returnerar alltid ett fel.
    const propertyInput = buildPropertyInput(typ, form, {
      hiss: uppgifter.hiss,
      balkong: uppgifter.balkong,
      avgiftInkluderar: uppgifter.ingar,
      antalPersoner: uppgifter.antalPersoner,
    });

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
        eyebrow="Steg 1 av 3"
        title="Analysera en bostad"
        lead={
          franRegister
            ? "Fyll i objektets uppgifter. Föreningens årsredovisning har vi redan."
            : "Ladda upp föreningens senaste årsredovisning och fyll i objektets uppgifter."
        }
      />
      <p className="-mt-4 mb-8 text-sm text-muted-foreground">
        Bara priskoll?{" "}
        <Link to="/vardering" className="font-medium text-primary underline underline-offset-2">
          Gratis och direkt
        </Link>
      </p>

      <SenasteAnalyserSektion />

      {foreningLage.typ === "laddar" ? (
        <Card className="mb-6" aria-busy="true">
          <p className="text-sm text-muted-foreground">Hämtar föreningen från registret…</p>
        </Card>
      ) : franRegister ? (
        <Card className="mb-6">
          <h2 className="font-display text-2xl text-foreground">
            Föreningens årsredovisning finns redan hos Binfo
          </h2>
          <p className="mt-2 text-sm text-foreground">
            <span className="font-medium">{franRegister.namn}</span> · räkenskapsår{" "}
            {franRegister.senaste.rakenskapsar} · analyserad{" "}
            {formatSkapadDatum(franRegister.senaste.analysdatum)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Du behöver bara fylla i uppgifterna om lägenheten nedan.
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
            {(visaFel || visaFilFel) && filFel ? (
              <p className="mt-3 text-sm text-danger">{filFel}</p>
            ) : null}
          </Card>
        </>
      )}

      <Card>
        <h2 className="font-display text-2xl text-foreground">Objektets uppgifter</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Uppgifterna används för att analysera objektet samt estimera dess värde och kostnader.
        </p>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Field
            label="Utgångspris"
            optional
            type="text"
            suffix="kr"
            placeholder="4 950 000"
            value={form.utgangspris}
            onChange={set("utgangspris")}
            error={visaFel ? fel.utgangspris : null}
          />
          <Field
            label="Boarea"
            type="text"
            suffix="m²"
            placeholder="58"
            value={form.boarea}
            onChange={(v) => {
              set("boarea")(v);
              setUppgifter({ boarea: Number(v.replace(",", ".")) || 0 });
            }}
            error={visaFel ? fel.boarea : null}
          />
          <Field
            label="Våning"
            placeholder="4"
            value={form.vaning}
            onChange={set("vaning")}
            error={visaFel ? fel.vaning : null}
          />
          <Field
            label="Månadsavgift"
            type="text"
            suffix="kr/mån"
            placeholder="3 240"
            value={form.manadsavgift}
            onChange={set("manadsavgift")}
            error={visaFel ? fel.manadsavgift : null}
          />
          <Field
            label="Antal rum"
            type="text"
            placeholder="3"
            value={form.antalRum}
            onChange={set("antalRum")}
            error={visaFel ? fel.antalRum : null}
          />
          <Field
            label="Adress"
            type="text"
            placeholder="Kapellgränd 12"
            value={form.adress}
            onChange={set("adress")}
            error={visaFel ? fel.adress : null}
          />
          <Field
            label="Postnummer"
            type="text"
            placeholder="116 25"
            value={form.postnummer}
            onChange={set("postnummer")}
            error={visaFel ? fel.postnummer : null}
          />
          <Field
            label="Ort"
            type="text"
            placeholder="Stockholm"
            value={form.ort}
            onChange={set("ort")}
            error={visaFel ? fel.ort : null}
          />
          <Field
            label="Byggår"
            optional
            placeholder="1931"
            value={form.byggar}
            onChange={set("byggar")}
          />
        </div>

        <div id="vet-ej" className="mt-8 scroll-mt-24 grid gap-6 md:grid-cols-2">
          <div>
            <span className="mb-2 block text-sm font-medium text-foreground">
              Hiss{" "}
              <span className="ml-1 text-xs font-normal text-muted-foreground">(valfritt)</span>
            </span>
            <TristateChoice value={uppgifter.hiss} onChange={(v) => setUppgifter({ hiss: v })} />
          </div>
          <div>
            <span className="mb-2 block text-sm font-medium text-foreground">
              Balkong{" "}
              <span className="ml-1 text-xs font-normal text-muted-foreground">(valfritt)</span>
            </span>
            <TristateChoice
              value={uppgifter.balkong}
              onChange={(v) => setUppgifter({ balkong: v })}
            />
          </div>
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
            {visaFel && (harFel || filFel)
              ? "Fyll i de obligatoriska fälten."
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
