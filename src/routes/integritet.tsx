import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, PageHeader } from "@/components/ui/binfo";
import { KONTAKT_EPOST, PERSONUPPGIFTSANSVARIG } from "@/lib/kontakt";

/**
 * Integritetspolicy. Facts here must match the code: retention in the
 * `binfo-retention` cron (12 months), cookies in src/server/kontext.ts and
 * sessionCookies.ts, browser storage in senasteAnalyser.ts / utkast.ts,
 * processors as deployed (Supabase eu-west-1, Cloudflare via Lovable,
 * Anthropic, Resend, Google Fonts). Change the code → change this page.
 */
export const Route = createFileRoute("/integritet")({
  head: () => ({
    meta: [
      { title: "Integritet och personuppgifter | Binfo" },
      {
        name: "description",
        content: "Vilka uppgifter Binfo sparar, varför, hur länge och vilka rättigheter du har.",
      },
      { property: "og:title", content: "Integritet och personuppgifter | Binfo" },
    ],
    links: [{ rel: "canonical", href: "https://binfo.slanesens.com/integritet" }],
  }),
  component: Integritet,
});

const SENAST_ANDRAD = "14 oktober 2026";

function Avsnitt({ rubrik, children }: { rubrik: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="font-display text-2xl">{rubrik}</h2>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-foreground">{children}</div>
    </Card>
  );
}

function Kontakt() {
  return KONTAKT_EPOST === null ? (
    <>kontakta oss</>
  ) : (
    <>
      mejla{" "}
      <a className="underline" href={`mailto:${KONTAKT_EPOST}`}>
        {KONTAKT_EPOST}
      </a>
    </>
  );
}

function Integritet() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader
        eyebrow="Integritet"
        title="Så hanterar vi dina uppgifter"
        lead={`Vi sparar så lite som möjligt och bara det som behövs för att tjänsten ska fungera. Senast ändrad ${SENAST_ANDRAD}.`}
      />
      <div className="space-y-6">
        <Avsnitt rubrik="Vem ansvarar">
          <p>
            Personuppgiftsansvarig: {PERSONUPPGIFTSANSVARIG}. Frågor om dina uppgifter, eller om du
            vill använda dina rättigheter nedan: <Kontakt />.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Utan konto">
          <p>Du kan använda Binfo utan konto. Då sparar vi:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Lägenhetsuppgifterna du anger vid en analys</strong> (pris, boarea, våning,
              avgift, adress, postnummer m.m.), kopplade till analysen så att du kan öppna den igen
              via länken. Adress, postnummer och organisationsnummer tas bort automatiskt efter 12
              månader. Ändamål: att leverera analysen. Rättslig grund: avtal (du har bett om
              tjänsten).
            </li>
            <li>
              <strong>En enhetscookie</strong> (<code>binfo_enhet</code>) med ett slumpat id, giltig
              i ett år. Den används för att begränsa missbruk (hur många analyser en enhet kan
              starta per dag) och för att kunna koppla dina tidigare analyser till ett konto om du
              skapar ett. Den innehåller inget om dig.
            </li>
            <li>
              <strong>Din IP-adress, men bara som en envägskodad kontrollsumma</strong>, för samma
              begränsning. Själva IP-adressen sparas inte, och kontrollsummorna raderas efter två
              dygn. Rättslig grund: berättigat intresse (att skydda tjänsten mot missbruk).
            </li>
          </ul>
          <p>
            Priskollen (steg 1 på{" "}
            <Link to="/analysera" className="underline">
              Analysera
            </Link>
            ) och bolånekalkylen sparar ingenting på servern om du inte själv trycker på Spara när
            du är inloggad. Bolånekalkylen räknar i din webbläsare.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Med konto">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>E-postadress och lösenord.</strong> Lösenordet lagras bara krypterat (hashat)
              hos vår databasleverantör; vi kan aldrig se det.
            </li>
            <li>
              <strong>Det du väljer att spara:</strong> värderingar (lägenhetens uppgifter och
              resultatet) och bolånekalkyler. En sparad kalkyl innehåller det du fyllt i, till
              exempel lånebelopp, ränta och bruttoinkomster. De sparas tills du raderar dem eller
              ditt konto.
            </li>
            <li>
              <strong>Två inloggningscookies</strong> (<code>binfo_sa</code>, <code>binfo_sr</code>)
              som håller dig inloggad, i högst 30 dagar utan aktivitet. De kan inte läsas av sidans
              JavaScript.
            </li>
          </ul>
          <p>
            Rättslig grund: avtal (kontot och det du sparar). Analyser du gör när du är inloggad
            kopplas till kontot. Loggar du in för första gången från en enhet kopplas också
            analyserna som den enheten gjort utan konto.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Årsredovisningar och BRF-registret">
          <p>
            Årsredovisningar du laddar upp sparas och analyseras. Analysen av föreningen (nyckeltal,
            betyg, varningsflaggor och frågor) sparas i Binfos register och visas offentligt under{" "}
            <Link to="/brf" className="underline">
              BRF-registret
            </Link>
            , så att nästa köpare i samma förening får den direkt. Registret visar aldrig vem som
            laddade upp rapporten eller något om din lägenhet.
          </p>
          <p>
            Årsredovisningar är offentliga handlingar men innehåller ofta namn på styrelseledamöter
            och revisorer. Vi sparar PDF:erna så att analysen kan göras om när metoden förbättras,
            och visar dem inte offentligt. Rättslig grund: berättigat intresse (att kunna erbjuda
            och förbättra föreningsanalyserna). Står du i en årsredovisning och vill invända,{" "}
            <Kontakt />.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="I din webbläsare">
          <p>
            Vi använder inga cookies för reklam eller spårning. I din webbläsares lokala lagring
            sparar vi en lista över dina senaste analyser (för att du ska hitta tillbaka, högst fem,
            i ett år) och, när du trycker på Spara utan att vara inloggad, ett utkast av det du
            fyllt i i högst ett dygn. Det stannar på din enhet.
          </p>
        </Avsnitt>

        <Avsnitt rubrik="Leverantörer som behandlar uppgifter åt oss">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Supabase</strong>: databas, filer och inloggning. Servrar i EU (Irland).
            </li>
            <li>
              <strong>Cloudflare</strong> (via Lovable, som publicerar sajten): driftar webbplatsen
              och ser därför IP-adresser i trafiken.
            </li>
            <li>
              <strong>Anthropic</strong>: AI-modellen som läser årsredovisningen. Den får PDF-filen,
              inte dina lägenhetsuppgifter. Anthropic finns i USA; överföringen sker med EU:s
              standardavtalsklausuler.
            </li>
            <li>
              <strong>Resend</strong>: skickar e-post (bekräftelse och återställning av lösenord).
            </li>
            <li>
              <strong>Google Fonts</strong>: typsnitten hämtas från Google, som då ser din
              IP-adress.
            </li>
          </ul>
        </Avsnitt>

        <Avsnitt rubrik="Dina rättigheter">
          <p>
            Du har rätt att få veta vilka uppgifter vi har om dig, att få dem rättade eller
            raderade, att invända mot behandling som grundar sig på berättigat intresse och att få
            ut uppgifterna du gett oss. Med konto gör du det själv under{" "}
            <Link to="/konto" className="underline">
              Mitt konto
            </Link>
            : "Ladda ner mina uppgifter" och "Radera konto". Utan konto, <Kontakt />.
          </p>
          <p>
            Är du missnöjd med hur vi hanterar dina uppgifter kan du klaga hos
            Integritetsskyddsmyndigheten (IMY), imy.se.
          </p>
        </Avsnitt>
      </div>
    </div>
  );
}
