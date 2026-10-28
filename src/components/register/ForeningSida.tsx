import { Link } from "@tanstack/react-router";
import { Brodsmulor } from "@/components/register/Brodsmulor";
import {
  Callout,
  Card,
  DataTable,
  GradeBadge,
  LinkButton,
  StatusPill,
  Tag,
} from "@/components/ui/binfo";
import {
  SKANNAD_NOTIS,
  arOgraderatNyckeltal,
  formatFigureVarde,
  formatSkapadDatum,
} from "@/lib/analysisView";
import { BETYG_TITEL } from "@/lib/betygVy";
import { KONTAKT_EPOST } from "@/lib/kontakt";
import {
  ALDRE_VERSION_TEXT,
  BETYG_FORKLARING,
  registeranalysPath,
  type RegisterArsSammanfattning,
  type RegisterForeningVy,
} from "@/lib/registerVy";
import type { KeyFigureId } from "@/types/analysis";

/**
 * Den publika föreningssidan `/brf/$slug`. Ägarbeslut 2026-10-23: bara
 * föreningens namn, räkenskapsår, riskbetyget och de sju nyckeltalen med
 * status. Ägarbeslut 2026-10-28 (Q6): även den lagrade betygsmotiveringen för
 * det senaste året. Röda flaggor och frågor finns på den sparade fullständiga
 * analysen (`/brf/$slug/analys/$ar`), som länken pekar på. Ingen köpardata
 * finns i `RegisterForeningVy`, så ingen kan renderas här.
 */

const ARSTABELL_KOLUMNER: Array<{ id: KeyFigureId; rubrik: string }> = [
  { id: "skuldsattning_per_m2_brf_yta", rubrik: "Skuld per m² bostadsrättsyta" },
  { id: "arsavgift_per_m2_brf_yta", rubrik: "Årsavgift per m²" },
  { id: "sparande_per_m2_totalyta", rubrik: "Sparande per m² totalyta" },
  { id: "rantekanslighet", rubrik: "Räntekänslighet" },
];

function nyckeltal(ar: RegisterArsSammanfattning, id: KeyFigureId): string {
  const kf = ar.nyckeltal.find((k) => k.id === id);
  return kf ? formatFigureVarde(kf.figure) : "–";
}

export function ForeningSida({ vy }: { vy: RegisterForeningVy }) {
  const s = vy.senaste;
  const meta = [
    vy.omrade?.namn,
    `org.nr ${vy.orgnr}`,
    `årsredovisning ${s.rakenskapsar}`,
    `analyserad ${formatSkapadDatum(s.analysdatum)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const felrapport =
    KONTAKT_EPOST === null
      ? null
      : `mailto:${KONTAKT_EPOST}?subject=${encodeURIComponent(`Fel på Binfos sida för ${vy.namn}`)}`;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-8 md:py-14">
      <div className="mb-8">
        <Brodsmulor
          steg={[
            { text: "BRF-register", till: { to: "/brf" } },
            ...(vy.omrade
              ? [
                  {
                    text: vy.omrade.namn,
                    till: {
                      to: "/brf/omrade/$omrade" as const,
                      params: { omrade: vy.omrade.slug },
                    },
                  },
                ]
              : []),
            { text: vy.namn },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-start gap-8">
        <div className="flex min-w-0 flex-[1_1_620px] flex-col gap-7">
          <header className="flex flex-col gap-2.5">
            <h1 className="font-display text-[34px] font-semibold leading-[1.1] text-primary md:text-[44px]">
              {vy.namn}
            </h1>
            <p className="text-[17px] text-text-2">{meta}</p>
            {vy.adresser.length > 0 ? (
              <p className="text-sm text-muted-foreground">
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
          </header>

          {s.skannad ? (
            <Callout variant="flag" title="Skannad årsredovisning">
              <p>{SKANNAD_NOTIS}</p>
            </Callout>
          ) : null}

          <Card className="flex flex-wrap items-start gap-6">
            <GradeBadge grade={s.betyg} size="lg" />
            <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2">
              <h2 className="text-[22px] font-semibold leading-[1.35] text-foreground">
                {BETYG_TITEL[s.betyg]}
              </h2>
              <p className="text-text-2">{s.betygMotivering ?? BETYG_FORKLARING}</p>
              <p className="text-sm text-muted-foreground">
                Betyg {s.betyg} på skalan A–E, där A är starkast.
              </p>
            </div>
          </Card>

          <section aria-labelledby="sju-nyckeltal" className="flex flex-col gap-4">
            <h2 id="sju-nyckeltal" className="text-[22px] font-semibold text-foreground">
              De sju nyckeltalen
            </h2>
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 p-0">
              {s.nyckeltal.map((kf) => (
                <li key={kf.id}>
                  <Card className="flex h-full flex-col gap-2 px-[22px] py-5 sm:p-5 sm:px-[22px]">
                    <div className="flex items-center justify-between gap-2">
                      {/* The 7th (andel av rörelseintäkter) is never rated: "Ingen bedömning". */}
                      <StatusPill status={arOgraderatNyckeltal(kf) ? "okant" : kf.status} />
                      <span className="flex items-center gap-1.5">
                        {kf.figure.osaker ? (
                          <span title={kf.figure.osaker}>
                            <Tag tone="warning">Osäker</Tag>
                          </span>
                        ) : null}
                        {kf.figure.ref ? (
                          <span
                            title={kf.figure.ref.excerpt}
                            className="text-[13px] text-muted-foreground"
                          >
                            s. {kf.figure.ref.page}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <h3 className="text-[15px] font-normal text-text-2">{kf.label}</h3>
                    <p className="font-display text-[26px] font-semibold text-primary">
                      {formatFigureVarde(kf.figure)}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          {s.aldreVersion ? (
            <p className="text-sm text-muted-foreground">{ALDRE_VERSION_TEXT}</p>
          ) : null}

          <div>
            <LinkButton
              to={registeranalysPath(vy.slug, s.rakenskapsar)}
              variant="secondary"
              size="lg"
            >
              Se hela analysen för varför föreningen fick betyget {s.betyg}
            </LinkButton>
          </div>

          {vy.tidigare.length > 0 ? (
            <section aria-labelledby="per-ar" className="flex flex-col gap-4">
              <h2 id="per-ar" className="text-[22px] font-semibold text-foreground">
                Nyckeltal per år
              </h2>
              <DataTable minWidth={720}>
                <thead>
                  <tr>
                    <th scope="col">År</th>
                    <th scope="col">Betyg</th>
                    {ARSTABELL_KOLUMNER.map((k) => (
                      <th key={k.id} scope="col">
                        {k.rubrik}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[s, ...vy.tidigare].map((ar) => (
                    <tr key={ar.rakenskapsar}>
                      <th scope="row">
                        <Link
                          to={registeranalysPath(vy.slug, ar.rakenskapsar)}
                          className="font-semibold text-link underline underline-offset-2"
                          title={`Se hela analysen för ${ar.rakenskapsar}`}
                        >
                          {ar.rakenskapsar}
                        </Link>
                      </th>
                      <td>
                        <GradeBadge grade={ar.betyg} size="sm" />
                      </td>
                      {ARSTABELL_KOLUMNER.map((k) => (
                        <td key={k.id}>{nyckeltal(ar, k.id)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </section>
          ) : null}
        </div>

        <aside
          aria-labelledby="kopa-har"
          className="flex flex-[1_1_320px] flex-col gap-3.5 rounded-lg bg-primary p-8 text-primary-foreground lg:sticky lg:top-6"
        >
          <h2 id="kopa-har" className="font-display text-[26px] font-semibold leading-[1.2]">
            Ska du köpa här?
          </h2>
          <p className="text-primary-foreground/90">
            Vi har redan årsredovisningen. Fyll i lägenhetens uppgifter så får du värdet med
            föreningens ekonomi inräknad, väntad avgiftshöjning och räntestress för just din
            lägenhet.
          </p>
          <LinkButton
            to={`/analysera?forening=${encodeURIComponent(vy.slug)}`}
            variant="secondary"
            size="lg"
          >
            Analysera en lägenhet här
          </LinkButton>
          <p className="text-sm text-primary-foreground/80">Ingen uppladdning behövs.</p>
        </aside>
      </div>

      <div className="mt-10 space-y-2 text-sm text-muted-foreground">
        <p>
          Siffrorna är hämtade ur föreningens årsredovisning och kan innehålla tolkningsfel.
          {felrapport === null ? null : (
            <>
              {" "}
              Hittar du ett fel?{" "}
              <a className="text-link underline" href={felrapport}>
                Säg till.
              </a>
            </>
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
