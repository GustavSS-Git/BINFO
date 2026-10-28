import { Link } from "@tanstack/react-router";
import { ForeningSektion } from "@/components/rapport/RapportForening";
import { Fragor } from "@/components/rapport/RapportFragor";
import {
  Callout,
  Card,
  GradeBadge,
  GradeScale,
  LinkButton,
  PageHeader,
} from "@/components/ui/binfo";
import { formatSkapadDatum } from "@/lib/analysisView";
import { BETYG_TITEL } from "@/lib/betygVy";
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
    <div className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-8 md:py-16">
      <Brodsmulor vy={vy} />
      <PageHeader
        eyebrow="Hela analysen"
        title={vy.namn}
        lead={`Den sparade analysen av årsredovisningen för räkenskapsåret ${a.rakenskapsar}, gjord ${formatSkapadDatum(a.analysdatum)}. Varje siffra visar vilken sida i årsredovisningen den kommer från.`}
      />

      <div className="flex flex-col gap-16">
        {a.aldreVersion ? (
          <Callout variant="notice" title="Analys från en tidigare version">
            <p>{ALDRE_VERSION_TEXT}</p>
          </Callout>
        ) : null}

        <Card className="flex flex-wrap items-center gap-6">
          <GradeBadge grade={a.betyg} size="lg" />
          <div className="flex min-w-0 max-w-[820px] flex-1 flex-col gap-2">
            <GradeScale grade={a.betyg} />
            <p className="text-[19px] font-semibold text-foreground">{BETYG_TITEL[a.betyg]}</p>
            <p className="text-[15px] text-text-2">{a.betygMotivering}</p>
          </div>
        </Card>

        <ForeningSektion analys={a} visaLead={false} />
        <Fragor analys={a} medPrognos={false} />

        <TillbakaLank slug={vy.slug} namn={vy.namn} />

        <Card className="flex flex-col gap-3">
          <h2 className="font-display text-2xl font-semibold text-primary">
            Köper du i den här föreningen?
          </h2>
          <p className="max-w-xl text-[15px] text-text-2">
            Fyll i uppgifterna om lägenheten så får du en priskontroll, månadskostnad och
            räntestress för just din bostad. Årsredovisningen har vi redan.
          </p>
          <div>
            <LinkButton to={`/analysera?forening=${encodeURIComponent(vy.slug)}`} size="lg">
              Analysera en lägenhet i föreningen
            </LinkButton>
          </div>
        </Card>

        <p className="text-sm text-muted-foreground">
          Siffrorna är hämtade ur föreningens årsredovisning och kan innehålla tolkningsfel.
          Analysen är beslutsstöd, inte finansiell rådgivning.
        </p>
      </div>
    </div>
  );
}

/**
 * Visas när åtkomsten till den sparade analysen nekas (konto eller betalning
 * kan krävas senare). Ett vanligt besked, inte ett fel.
 */
export function RegisterAnalysNekad({ slug, meddelande }: { slug: string; meddelande: string }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-8 md:py-16">
      <PageHeader
        eyebrow="Hela analysen"
        title="Analysen är inte tillgänglig just nu"
        lead={meddelande}
      />
      <TillbakaLank slug={slug} namn="föreningens sammanfattning" />
    </div>
  );
}
