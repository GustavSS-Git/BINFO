import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Eyebrow, LinkButton } from "@/components/ui/binfo";
import { KONTAKT_EPOST } from "@/lib/kontakt";

/**
 * Om oss. Built from the owner's "Om oss" artboard (local about_us/v4/OmOss.dc.html, not in git;
 * 2026-11-07). Linked from the footer only, never from the main nav (owner).
 * Copy follows the artboard except where the copy rules forbid it: no "gratis"
 * (CLAUDE.md "Design system"). The artboard's "Så räknar vi" link is left out
 * (no method page; owner 2026-11-07). Contact: the shared `KONTAKT_EPOST`.
 */
export const Route = createFileRoute("/om-oss")({
  head: () => ({
    meta: [
      { title: "Om oss | Binfo" },
      {
        name: "description",
        content:
          "Binfo är byggt av fyra studenter på industriell ekonomi, KTH: oberoende stöd för dig som köper bostadsrätt, öppet med hur allt räknas.",
      },
      { property: "og:title", content: "Om oss | Binfo" },
      {
        property: "og:description",
        content: "Säljaren har en expert. Nu har köparen också det.",
      },
    ],
    links: [{ rel: "canonical", href: "https://binfo.slanesens.com/om-oss" }],
  }),
  component: OmOss,
});

const CONTAINER = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";
const H2 = "font-display text-[28px] font-semibold leading-[1.2] text-primary md:text-[32px]";

function Ikon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-11 items-center justify-center rounded-lg bg-tint">
      <svg
        aria-hidden="true"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary"
      >
        {children}
      </svg>
    </span>
  );
}

const LOFTEN: { rubrik: string; ikon: ReactNode; text: ReactNode }[] = [
  {
    rubrik: "Inget att sälja",
    ikon: (
      <>
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    text: "Vi har inget vinstintresse och är inte kopplade till mäklare, banker eller föreningar. Ingen tjänar på vad du väljer.",
  },
  {
    rubrik: "Full transparens",
    ikon: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M20 20l-4.2-4.2" />
      </>
    ),
    text: "Du ska förstå varför vi säger det vi säger. Varje bedömning visar vilka siffror den bygger på.",
  },
  {
    rubrik: "Ingen betalvägg",
    ikon: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 7.5-2" />
      </>
    ),
    text: "Analyser, BRF-register, bolånekalkyl och köpguide är öppna för alla. Bra information om ditt livs största köp ska inte kosta extra.",
  },
];

function OmOss() {
  return (
    <div className="bg-card">
      <section className="border-b border-border bg-background">
        <div className={`${CONTAINER} flex flex-col gap-4 pb-12 pt-12 md:pb-14 md:pt-16`}>
          <Eyebrow>Om oss</Eyebrow>
          <h1 className="max-w-[820px] font-display text-[36px] font-semibold leading-[1.1] text-primary md:text-[48px]">
            Säljaren har en expert. Nu har köparen också det.
          </h1>
          <p className="max-w-[720px] text-lg text-text-2 md:text-[19px]">
            Binfo är byggt av fyra studenter som själva är, eller snart blir, förstagångsköpare. Vi
            gjorde sidan vi saknade: oberoende och öppen med hur allt räknas.
          </p>
        </div>
      </section>

      <div
        className={`${CONTAINER} flex flex-col gap-14 pb-20 pt-12 md:gap-[72px] md:pb-24 md:pt-16`}
      >
        <section aria-labelledby="varfor-rubrik" className="flex max-w-[780px] flex-col gap-5">
          <h2 id="varfor-rubrik" className={H2}>
            Varför vi skapade Binfo
          </h2>
          <div className="flex flex-col gap-[18px] text-[17px] text-text-2">
            <p>
              Vi är Tilda, Gustav, Esther och Ellinor och läser industriell ekonomi på KTH. Binfo
              har vi byggt som en del av vår projektkurs.
            </p>
            <p>
              Bostadsmarknaden är svår att förstå, särskilt om dina föräldrar inte är från Stockholm
              eller inte själva äger en bostad. Då finns det ingen naturlig person att fråga om
              årsredovisningar, budgivning eller vad en rimlig månadskostnad är.
            </p>
            <p>
              Vi saknade en pålitlig sida där ingen försöker sälja på oss något, där man faktiskt
              förstår vad som ligger bakom rekommendationerna och där det inte finns någon
              betalvägg. Det kändes orättvist att bara säljaren har en expert vid sin sida. Därför
              skapade vi Binfo.
            </p>
          </div>
        </section>

        <section aria-labelledby="lofte-rubrik" className="flex flex-col gap-6">
          <h2 id="lofte-rubrik" className={H2}>
            Det här lovar vi
          </h2>
          <ul className="grid list-none gap-5 p-0 md:grid-cols-3">
            {LOFTEN.map((l) => (
              <li
                key={l.rubrik}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6 sm:p-7"
              >
                <Ikon>{l.ikon}</Ikon>
                <h3 className="text-[19px] font-semibold text-foreground">{l.rubrik}</h3>
                <p className="text-[15px] text-text-2">{l.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="teamet-rubrik" className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 id="teamet-rubrik" className={H2}>
              Vi som står bakom Binfo
            </h2>
            <p className="text-muted-foreground">
              Studenter på industriell ekonomi, KTH. Alla är eller blir snart förstagångsköpare.
            </p>
          </div>
          <figure className="flex flex-col gap-2.5">
            <img
              src="/bilder/om-oss.jpg"
              alt="Från vänster Esther, Tilda, Gustav och Ellinor står tillsammans på KTH:s campus i kvällssol"
              width={2048}
              height={1536}
              loading="lazy"
              decoding="async"
              className="block aspect-[4/3] w-full rounded-xl object-cover object-[50%_62%] md:aspect-auto md:h-[560px]"
            />
            <figcaption className="text-sm text-muted-foreground">
              Från vänster: Esther (Stockholm), Tilda (Uppsala), Gustav (Stockholm) och Ellinor
              (Stockholm) på KTH:s campus.
            </figcaption>
          </figure>
          {KONTAKT_EPOST !== null ? (
            <div className="flex flex-col gap-2.5 rounded-lg bg-background px-6 py-6 sm:px-7">
              <h3 className="text-[19px] font-semibold text-foreground">
                Frågor? Hör av dig till oss
              </h3>
              <p>
                <a
                  href={`mailto:${KONTAKT_EPOST}`}
                  className="font-medium text-link hover:text-primary"
                >
                  {KONTAKT_EPOST}
                </a>
              </p>
            </div>
          ) : null}
        </section>

        <section
          aria-labelledby="cta-rubrik"
          className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5 rounded-xl bg-primary p-7 text-primary-foreground sm:p-10"
        >
          <div className="flex max-w-[640px] flex-col gap-2">
            <h2 id="cta-rubrik" className="font-display text-[26px] font-semibold md:text-[28px]">
              Köp med lika mycket kunskap som säljaren
            </h2>
            <p className="text-primary-foreground/85">
              Börja med en bostad du har sett, eller läs köpguiden steg för steg.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <LinkButton
              to="/analysera"
              size="lg"
              className="border-card bg-card text-primary hover:bg-tint"
            >
              Analysera en bostad
            </LinkButton>
            <LinkButton
              to="/kopguide"
              size="lg"
              className="border-primary-foreground/50 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
            >
              Läs köpguiden
            </LinkButton>
          </div>
        </section>
      </div>
    </div>
  );
}
