import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { Eyebrow, GradeBadge, GradeScale, LinkButton, StatusPill } from "@/components/ui/binfo";
import { antalIOrd, medVersal } from "@/lib/analysisView";
import { synligaSteg } from "@/lib/kopguide/framsteg";
import { byggStartExempel } from "@/lib/startExempel";

const TITEL = "Binfo: oberoende beslutsstöd för dig som köper bostadsrätt";
const BESKRIVNING =
  "Binfo granskar föreningens årsredovisning, kollar om priset är rimligt och räknar ut om du har råd med bostaden. Varje siffra med sidhänvisning.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITEL },
      { name: "description", content: BESKRIVNING },
      { property: "og:title", content: TITEL },
      { property: "og:description", content: BESKRIVNING },
    ],
  }),
  component: Index,
});

const CONTAINER = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";
const H2 = "font-display text-[30px] font-semibold leading-[1.15] text-primary md:text-[38px]";
const LANK = "mt-auto text-[15px] font-semibold text-link no-underline hover:text-primary";

function Ikon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-11 items-center justify-center rounded-md bg-tint text-primary"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

function Bock() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stroke-success"
    >
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

const FRAGOR = [
  {
    rubrik: "Är föreningen frisk?",
    text: "Vi läser årsredovisningen, förklarar de sju lagstadgade nyckeltalen på vanlig svenska, flaggar det som avviker och tar fram frågor att ställa till styrelsen.",
    lank: "Granska föreningen →",
    to: "/analysera",
    ikon: (
      <>
        <path d="M4 21V8l8-5 8 5v13" />
        <path d="M9 21v-6h6v6" />
      </>
    ),
  },
  {
    rubrik: "Är priset rimligt?",
    text: "Utgångspriset säger mer om mäklarens strategi än om bostadens värde. Vi jämför med vad liknande bostäder i området faktiskt sålts för.",
    lank: "Kolla priset →",
    to: "/analysera",
    ikon: (
      <>
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M15 7h6v6" />
      </>
    ),
  },
  {
    rubrik: "Har jag råd med just den här?",
    text: "Hela månadskostnaden: ränta efter avdrag, amortering, avgift och drift. Och vad som händer med plånboken om räntan stiger.",
    lank: "Räkna på månadskostnaden →",
    to: "/bolanekalkyl",
    ikon: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h8M8 11h8M8 15h4" />
      </>
    ),
  },
];

const STEG = [
  {
    rubrik: "Fyll i bostadens uppgifter",
    text: "Adress, yta, avgift och utgångspris, eller klistra in länken från Booli så fyller vi i åt dig.",
  },
  {
    rubrik: "Ladda upp årsredovisningen",
    text: "PDF:en du får av mäklaren. Har vi redan granskat föreningen behövs ingen uppladdning.",
  },
  {
    rubrik: "Få rapporten på några minuter",
    text: "Betyg, nyckeltal med sidhänvisning, prisbild, räntestress och frågor till styrelsen.",
  },
];

const PUNKTER = [
  { rubrik: "Oberoende", text: "Ingen koppling till mäklare, bank eller förening." },
  { rubrik: "Spårbart", text: "Varje nyckeltal hänvisar till sidan i årsredovisningen." },
  {
    rubrik: "Dina uppgifter stannar hos dig",
    text: "Kalkylen körs i webbläsaren. Inget säljs vidare.",
  },
];

const STORT_TAL =
  "mt-2.5 flex min-h-[30px] items-end gap-2.5 font-display text-[26px] font-semibold leading-none text-primary tabular-nums";

function ExempelKort({ rubrik, children }: { rubrik: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-[1_1_160px] flex-col rounded-md border border-border border-t-[3px] border-t-primary bg-card px-[18px] py-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {rubrik}
      </span>
      {children}
    </div>
  );
}

function Exempelblock() {
  const e = byggStartExempel(sampleAnalysis);
  const rad2 = "mt-2.5 text-[13px] font-semibold tabular-nums text-foreground";
  const text = "mt-1 text-[13px] leading-[1.45] text-text-2";
  return (
    <div
      aria-label="Exempel på en analys"
      className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4 shadow-[0_12px_32px_rgba(10,47,94,0.08)] sm:p-6 lg:col-span-7"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Eyebrow as="span" className="!text-xs">
          {e.rubrik}
        </Eyebrow>
        <span className="text-[13px] text-muted-foreground">{e.undertext}</span>
      </div>
      <div className="flex flex-wrap items-stretch gap-2.5">
        <ExempelKort rubrik="Föreningen">
          <div className="mt-2.5 flex min-h-[30px] items-end gap-2.5">
            <GradeBadge grade={e.forening.betyg} size="sm" />
            <GradeScale grade={e.forening.betyg} className="mb-px" />
          </div>
          <span className={rad2}>{e.forening.titel}</span>
          <span className={text}>{e.forening.text}</span>
        </ExempelKort>
        <ExempelKort rubrik="Binfos värdering">
          <div className={STORT_TAL}>{e.vardering.varde}</div>
          {e.vardering.spann ? <span className={rad2}>{e.vardering.spann}</span> : null}
          {e.vardering.text ? <span className={text}>{e.vardering.text}</span> : null}
        </ExempelKort>
        <ExempelKort rubrik="Avgiften framåt">
          <div className={STORT_TAL}>{e.avgift.varde}</div>
          {e.avgift.rad ? <span className={rad2}>{e.avgift.rad}</span> : null}
          <span className={text}>{e.avgift.text}</span>
        </ExempelKort>
      </div>
      <div className="rounded-md border border-border bg-card px-4 pb-2 pt-1.5">
        <p className="mb-0.5 mt-2 text-[13px] font-semibold text-muted-foreground">
          Ett urval av de sju nyckeltalen
        </p>
        {e.nyckeltal.map((r) => (
          <div
            key={r.etikett}
            className="flex items-center justify-between gap-3 border-t border-divider py-2 text-sm"
          >
            <span className="text-text-2">{r.etikett}</span>
            <span className="flex items-center gap-2.5">
              <strong className="text-foreground">{r.varde}</strong>
              <StatusPill status={r.status} />
            </span>
          </div>
        ))}
      </div>
      <Link to="/exempel" className="text-[15px] font-semibold text-link no-underline">
        Se hela exempelrapporten →
      </Link>
    </div>
  );
}

function Index() {
  const antalSteg = synligaSteg("brf").length;
  return (
    <div className="bg-card">
      {/* Hero */}
      <section className="border-b border-border bg-background">
        <div
          className={`${CONTAINER} grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-2 lg:gap-8 lg:py-[88px]`}
        >
          <div className="flex flex-col gap-6">
            <Eyebrow>Oberoende beslutsstöd för bostadsköpare</Eyebrow>
            <h1 className="font-display text-[36px] font-semibold leading-[1.08] tracking-[-0.015em] text-primary sm:text-[44px] lg:text-[56px]">
              Säljaren har en mäklare. Nu har du Binfo.
            </h1>
            <p className="max-w-[540px] text-lg leading-normal text-text-2 sm:text-xl">
              Binfo guidar dig genom köpet, granskar föreningen, kollar om priset är rimligt och
              räknar ut om du har råd med just den här bostaden.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <LinkButton to="/analysera" size="lg">
                Analysera en bostad
              </LinkButton>
              <LinkButton to="/exempel" size="lg" variant="secondary">
                Se en exempelrapport
              </LinkButton>
            </div>
            <ul className="mt-2 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-sm text-muted-foreground">
              {["Inte kopplat till mäklare eller bank", "Varje siffra med sidhänvisning"].map(
                (t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Bock />
                    {t}
                  </li>
                ),
              )}
            </ul>
          </div>
          <img
            src="/bilder/flytt.jpg"
            alt="Ett par bär en flyttkartong tillsammans i sin nya ljusa lägenhet och skrattar"
            width={1200}
            height={651}
            decoding="async"
            className="block aspect-[586/381] w-full max-w-[586px] justify-self-end rounded-lg object-cover object-[38%_center]"
          />
        </div>
      </section>

      {/* Tre frågor */}
      <section
        className={`${CONTAINER} flex flex-col gap-10 py-14 sm:py-20 lg:gap-12 lg:pb-[72px] lg:pt-24`}
        aria-labelledby="fragor-rubrik"
      >
        <div className="flex max-w-[640px] flex-col gap-3">
          <h2 id="fragor-rubrik" className={H2}>
            Tre frågor du behöver svar på innan du budar
          </h2>
          <p className="text-lg text-text-2">
            Mäklaren svarar på säljarens frågor. Binfo svarar på dina.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {FRAGOR.map((f) => (
            <article
              key={f.rubrik}
              className="flex flex-col gap-3.5 rounded-lg border border-border p-6 sm:p-8"
            >
              <Ikon>{f.ikon}</Ikon>
              <h3 className="text-[21px] font-semibold text-foreground">{f.rubrik}</h3>
              <p className="text-text-2">{f.text}</p>
              <Link to={f.to} className={LANK}>
                {f.lank}
              </Link>
            </article>
          ))}
        </div>
      </section>

      {/* Så fungerar det */}
      <section className="border-y border-border bg-background" aria-labelledby="sa-rubrik">
        <div
          className={`${CONTAINER} grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-12 lg:gap-8`}
        >
          <div className="flex flex-col gap-7 lg:col-span-5">
            <h2 id="sa-rubrik" className={H2}>
              Så fungerar det
            </h2>
            <ol className="flex list-none flex-col gap-[22px] p-0">
              {STEG.map((s, i) => (
                <li key={s.rubrik} className="flex gap-4">
                  <span
                    aria-hidden="true"
                    className="flex size-8 flex-none items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-foreground">{s.rubrik}</p>
                    <p className="mt-0.5 text-[15px] text-text-2">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <Exempelblock />
        </div>
      </section>

      {/* Köpguide + register */}
      <section className={`${CONTAINER} grid gap-6 py-14 sm:py-20 md:grid-cols-2`}>
        <div className="flex flex-col gap-3.5 rounded-lg border border-border bg-card p-6 sm:p-10">
          <Eyebrow>Köpguide</Eyebrow>
          <h3 className="font-display text-[28px] font-semibold leading-[1.2] text-primary">
            Hela köpet, från lånelöfte till tillträde
          </h3>
          <p className="text-text-2">
            {medVersal(antalIOrd(antalSteg))} steg med vad du ska se upp med och vad du gör härnäst.
            Bocka av i takt med att du kommer framåt.
          </p>
          <Link to="/kopguide" className={`${LANK} mt-2.5`}>
            Öppna köpguiden →
          </Link>
        </div>
        <div
          id="register"
          className="flex flex-col gap-3.5 rounded-lg border border-border bg-card p-6 sm:p-10"
        >
          <Eyebrow>BRF-register</Eyebrow>
          <h3 className="font-display text-[28px] font-semibold leading-[1.2] text-primary">
            Föreningar i Stockholm, område för område
          </h3>
          <p className="text-text-2">
            Nyckeltal och betyg för föreningar vars årsredovisning redan analyserats. Sök på
            förening eller bläddra per stadsdel.
          </p>
          <Link to="/brf" className={`${LANK} mt-2.5`}>
            Sök i registret →
          </Link>
        </div>
      </section>

      {/* Oberoende */}
      <section className="bg-primary text-primary-foreground" aria-labelledby="oberoende-rubrik">
        <div className={`${CONTAINER} grid items-start gap-8 py-14 sm:py-[88px] lg:grid-cols-12`}>
          <div className="flex flex-col gap-5 lg:col-span-7">
            <h2
              id="oberoende-rubrik"
              className="font-display text-[32px] font-semibold leading-[1.12] tracking-[-0.01em] md:text-[40px]"
            >
              Vi tjänar ingenting på att du köper.
            </h2>
            <p className="max-w-[600px] text-lg leading-[1.55] text-primary-foreground/85">
              Säljaren anlitar och betalar mäklaren. Banken tjänar på ditt lån. Binfo tar ingen
              provision från mäklare, banker eller föreningar. Därför kan vi säga det rakt ut när en
              bostad är för dyr, när en förening har problem, eller när du borde låta bli att buda.
            </p>
          </div>
          <ul className="grid list-none gap-3 p-0 lg:col-span-5">
            {PUNKTER.map((p) => (
              <li
                key={p.rubrik}
                className="rounded-md border border-primary-foreground/20 px-5 py-[18px]"
              >
                <p className="font-semibold">{p.rubrik}</p>
                <p className="mt-0.5 text-[15px] text-primary-foreground/85">{p.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
