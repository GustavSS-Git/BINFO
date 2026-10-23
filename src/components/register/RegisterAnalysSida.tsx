import { Link } from "@tanstack/react-router";
import {
  Betygskort,
  Foreningsekonomi,
  Fragor,
  OvrigInfo,
  RodaFlaggor,
} from "@/components/AnalysRapport";
import { Callout, Card, LinkButton, PageHeader } from "@/components/ui/binfo";
import { SKANNAD_NOTIS, arSkannad, formatSkapadDatum } from "@/lib/analysisView";
import { ALDRE_VERSION_TEXT, foreningPath, type RegisterAnalysVy } from "@/lib/registerVy";

/**
 * Den sparade fullständiga BRF-analysen `/brf/$slug/analys/$ar` (ägarbeslut
 * 2026-10-23): motivering, röda flaggor, nyckeltal med sidhänvisningar,
 * övrig info och frågor till styrelsen, exakt som de lagrades när analysen
 * kördes (ingen omkörning vid visning). Återanvänder rapportens egna
 * sektioner ur AnalysRapport.tsx. Ingen köpardata finns i `RegisterAnalysVy`.
 */

function Brodsmulor({ vy }: { vy: RegisterAnalysVy }) {
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
      <Link to={foreningPath(vy.slug)} className="underline-offset-2 hover:underline">
        {vy.namn}
      </Link>
      {" › "}
      <span aria-current="page">Analys {vy.analys.rakenskapsar}</span>
    </nav>
  );
}

function TillbakaLank({ slug, namn }: { slug: string; namn: string }) {
  return (
    <Link to={foreningPath(slug)} className="font-medium text-primary underline underline-offset-2">
      Tillbaka till {namn}
    </Link>
  );
}

export function RegisterAnalysSida({ vy }: { vy: RegisterAnalysVy }) {
  const a = vy.analys;

  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <Brodsmulor vy={vy} />
      <PageHeader
        eyebrow="Hela analysen"
        title={vy.namn}
        lead={`Den sparade analysen av årsredovisningen för räkenskapsåret ${a.rakenskapsar}, gjord ${formatSkapadDatum(a.analysdatum)}. Varje siffra visar vilken sida i årsredovisningen den kommer från.`}
      />

      {arSkannad(a) ? (
        <div className="mb-6">
          <Callout variant="flag" title="Skannad årsredovisning">
            <p>{SKANNAD_NOTIS}</p>
          </Callout>
        </div>
      ) : null}
      {a.aldreVersion ? (
        <p className="mb-6 text-sm text-muted-foreground">{ALDRE_VERSION_TEXT}</p>
      ) : null}

      <Betygskort betyg={a.betyg} motivering={a.betygMotivering} />
      <RodaFlaggor analys={a} />
      <Foreningsekonomi analys={a} />
      <OvrigInfo analys={a} />
      <Fragor analys={a} />

      <div className="mt-8">
        <TillbakaLank slug={vy.slug} namn={vy.namn} />
      </div>

      <Card className="mt-10">
        <h2 className="font-display text-2xl tracking-tight text-foreground">
          Köper du i den här föreningen?
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Fyll i uppgifterna om lägenheten så får du en priskontroll, månadskostnad och räntestress
          för just din bostad. Årsredovisningen har vi redan.
        </p>
        <div className="mt-5">
          <LinkButton to={`/analysera?forening=${encodeURIComponent(vy.slug)}`} size="lg">
            Analysera en lägenhet i föreningen
          </LinkButton>
        </div>
      </Card>

      <p className="mt-8 text-xs text-muted-foreground">
        Siffrorna är hämtade ur föreningens årsredovisning och kan innehålla tolkningsfel. Analysen
        är beslutsstöd, inte finansiell rådgivning.
      </p>
    </div>
  );
}

/**
 * Visas när åtkomsten till den sparade analysen nekas (konto eller betalning
 * kan krävas senare). Ett vanligt besked, inte ett fel.
 */
export function RegisterAnalysNekad({ slug, meddelande }: { slug: string; meddelande: string }) {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <PageHeader
        eyebrow="Hela analysen"
        title="Analysen är inte tillgänglig just nu"
        lead={meddelande}
      />
      <TillbakaLank slug={slug} namn="föreningens sammanfattning" />
    </div>
  );
}
