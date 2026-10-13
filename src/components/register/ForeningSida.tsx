import { Link } from "@tanstack/react-router";
import {
  Betygskort,
  Foreningsekonomi,
  Fragor,
  OvrigInfo,
  RodaFlaggor,
} from "@/components/AnalysRapport";
import { Betygsmarke } from "@/components/register/RegisterLista";
import { Callout, Card, LinkButton, PageHeader, SectionTitle } from "@/components/ui/binfo";
import { SKANNAD_NOTIS, formatFigureVarde, formatSkapadDatum } from "@/lib/analysisView";
import { KONTAKT_EPOST } from "@/lib/kontakt";
import { ALDRE_VERSION_TEXT, type RegisterArsvy, type RegisterForeningVy } from "@/lib/registerVy";
import type { KeyFigureId } from "@/types/analysis";

/**
 * Den publika föreningssidan `/brf/$slug`: BRF-nivåns delar av analysen
 * (betyg, röda flaggor, nyckeltal med sidhänvisningar, frågor till styrelsen)
 * återanvänder rapportens egna sektioner ur AnalysRapport.tsx. Ingen
 * köpardata finns i `RegisterForeningVy`, så ingen kan renderas här.
 */

const ARSTABELL_KOLUMNER: Array<{ id: KeyFigureId; rubrik: string }> = [
  { id: "skuldsattning_per_m2_brf_yta", rubrik: "Skuld per m² bostadsrättsyta" },
  { id: "arsavgift_per_m2_brf_yta", rubrik: "Årsavgift per m²" },
  { id: "sparande_per_m2_totalyta", rubrik: "Sparande per m² totalyta" },
  { id: "rantekanslighet", rubrik: "Räntekänslighet" },
];

function nyckeltal(vy: RegisterArsvy, id: KeyFigureId): string {
  const kf = vy.forening.keyFigures.find((k) => k.id === id);
  return kf ? formatFigureVarde(kf.figure) : "–";
}

function Brodsmulor({ vy }: { vy: RegisterForeningVy }) {
  return (
    <nav aria-label="Du är här" className="mb-6 text-sm text-muted-foreground">
      <Link to="/brf" className="underline-offset-2 hover:underline">
        BRF-register
      </Link>
      {vy.omrade ? (
        <>
          {" › "}
          <Link
            to="/brf/omrade/$omrade"
            params={{ omrade: vy.omrade.slug }}
            className="underline-offset-2 hover:underline"
          >
            {vy.omrade.namn}
          </Link>
        </>
      ) : null}
      {" › "}
      <span aria-current="page">{vy.namn}</span>
    </nav>
  );
}

export function ForeningSida({ vy }: { vy: RegisterForeningVy }) {
  const s = vy.senaste;
  const rader: Array<[string, string]> = [
    ["Organisationsnummer", vy.orgnr],
    ["Område", vy.omrade?.namn ?? "–"],
    ["Räkenskapsår", String(s.rakenskapsar)],
    ["Analyserad", formatSkapadDatum(s.analysdatum)],
  ];

  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <Brodsmulor vy={vy} />
      <PageHeader
        eyebrow="Föreningens analys"
        title={vy.namn}
        lead={`Nyckeltal och bedömning enligt årsredovisningen för ${s.rakenskapsar}. Varje siffra visar vilken sida i årsredovisningen den kommer från.`}
      />

      <Card className="mb-8">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          {rader.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        {vy.adresser.length > 0 ? (
          <p className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
            Adress enligt årsredovisningen:{" "}
            {vy.adresser
              .map((a) =>
                [a.gatuadress, [a.postnummer, a.ort].filter(Boolean).join(" ")]
                  .filter(Boolean)
                  .join(", "),
              )
              .join(" · ")}
          </p>
        ) : null}
      </Card>

      {s.datakvalitet.kalla === "skannad" ? (
        <div className="mb-6">
          <Callout variant="flag" title="Skannad årsredovisning">
            <p>{SKANNAD_NOTIS}</p>
          </Callout>
        </div>
      ) : null}
      {s.aldreVersion ? (
        <p className="mb-6 text-sm text-muted-foreground">{ALDRE_VERSION_TEXT}</p>
      ) : null}

      <Betygskort betyg={s.betyg} motivering={s.betygMotivering} />
      <RodaFlaggor analys={s} />
      <Foreningsekonomi analys={s} />
      <OvrigInfo analys={s} />
      <Fragor analys={s} />

      {vy.tidigare.length > 0 ? (
        <section className="mt-10">
          <SectionTitle hint="Samma nyckeltal ur föreningens analyserade årsredovisningar, nyaste först">
            Nyckeltal per år
          </SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    År
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Betyg
                  </th>
                  {ARSTABELL_KOLUMNER.map((k) => (
                    <th key={k.id} scope="col" className="px-4 py-3 font-semibold">
                      {k.rubrik}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[s, ...vy.tidigare].map((ar) => (
                  <tr key={ar.rakenskapsar} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-3 text-left font-medium text-foreground">
                      {ar.rakenskapsar}
                    </th>
                    <td className="px-4 py-3">
                      <Betygsmarke betyg={ar.betyg} />
                    </td>
                    {ARSTABELL_KOLUMNER.map((k) => (
                      <td key={k.id} className="px-4 py-3 text-foreground">
                        {nyckeltal(ar, k.id)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <Card className="mt-10">
        <h2 className="font-display text-2xl tracking-tight text-foreground">
          Köper du i den här föreningen?
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Med årsredovisningen och uppgifterna om lägenheten får du också en priskontroll, en
          månadskostnad och en räntestress för just din bostad.
        </p>
        <div className="mt-5">
          <LinkButton to="/analysera" size="lg">
            Analysera en lägenhet i föreningen
          </LinkButton>
        </div>
      </Card>

      <div className="mt-8 space-y-2 text-xs text-muted-foreground">
        <p>
          Siffrorna är hämtade ur föreningens årsredovisning och kan innehålla tolkningsfel. Hittar
          du ett fel?{" "}
          {KONTAKT_EPOST === null ? (
            "Kontakta oss."
          ) : (
            <a className="underline" href={`mailto:${KONTAKT_EPOST}`}>
              Mejla oss
            </a>
          )}
        </p>
        <p>
          Områdesindelning: © OpenStreetMap-bidragsgivare (ODbL), Stockholms stad. Analysen är
          beslutsstöd, inte finansiell rådgivning.
        </p>
      </div>
    </div>
  );
}
