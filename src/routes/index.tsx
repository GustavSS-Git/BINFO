import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, LinkButton, Badge } from "@/components/ui/binfo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Binfo — vet vad du budar på" },
      {
        name: "description",
        content:
          "Oberoende risk- och priskontroll för bostaden du är på väg att buda på. Ladda upp årsredovisningen och få en analys på minuter.",
      },
      { property: "og:title", content: "Binfo — vet vad du budar på" },
      {
        property: "og:description",
        content: "Oberoende risk- och priskontroll för bostadsköpare i Sverige.",
      },
    ],
  }),
  component: Index,
});

const steg = [
  {
    nr: "01",
    titel: "Ladda upp årsredovisningen",
    text: "PDF:en från mäklaren räcker. Vi läser nyckeltalen åt dig.",
  },
  {
    nr: "02",
    titel: "Få din analys",
    text: "Riskbetyg, röda flaggor, prisrimlighet och räntestress — på några minuter.",
  },
  {
    nr: "03",
    titel: "Fatta beslut",
    text: "Gå in i budgivningen med en egen gräns och rätt frågor till styrelsen.",
  },
];

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Index() {
  return (
    <div className="mx-auto max-w-6xl px-5">
      <section className="py-16 md:py-28">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div>
            <Badge tone="teal">Oberoende beslutsstöd</Badge>
            <h1 className="mt-6 max-w-4xl font-display text-5xl leading-[1.05] tracking-tight text-foreground md:text-7xl">
              Säljaren har en mäklare. Nu har du Binfo.
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
              Binfo guidar dig genom köpet, granskar föreningen, kollar priset och räknar ut om du har råd med just den
              här bostaden.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <LinkButton to="/analysera" size="lg">
                Analysera en bostad
              </LinkButton>
              <LinkButton to="/guide" size="lg" variant="secondary">
                Se köpguiden
              </LinkButton>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Bara priskoll?{" "}
              <Link to="/vardering" className="font-medium text-primary underline underline-offset-2">
                Klicka här
              </Link>
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Oberoende · Inte kopplad till mäklare, bank eller förening. ·{" "}
              <Link to="/exempel" className="font-medium text-primary underline underline-offset-2">
                Se ett exempel på en rapport
              </Link>
            </p>
          </div>
          <div className="dossier-wrap">
            <article className="dossier" aria-label="Exempel på en rapport från Binfo">
              <span className="dossier-tab">Din rapport</span>
              <header className="dossier-head">
                <h2 className="dossier-title">2 rok på Södermalm</h2>
                <p className="dossier-sub">Bostadsrätt, 58 m², byggår 1929</p>
                <dl className="facts">
                  <div>
                    <dt>Utgångspris</dt>
                    <dd>4 950 000 kr</dd>
                  </div>
                  <div>
                    <dt>Avgift</dt>
                    <dd>3 630 kr/mån</dd>
                  </div>
                  <div>
                    <dt>Visning</dt>
                    <dd>Sön 13.00</dd>
                  </div>
                </dl>
              </header>

              <ol className="dsteps">
                <li className="is-flag" style={{ "--d": ".35s" } as React.CSSProperties}>
                  <a href="#foreningen">
                    <span className="marker" aria-hidden="true">
                      !
                    </span>
                    <span>
                      <span className="dstep-name">Föreningen</span>
                      <span className="dstep-val">Stambyte saknas i underhållsplanen. Skuld 14 200 kr/m².</span>
                    </span>
                    <span className="chip">2 flaggor</span>
                  </a>
                </li>
                <li className="is-done" style={{ "--d": ".65s" } as React.CSSProperties}>
                  <a href="#priset">
                    <span className="marker" aria-hidden="true">
                      <CheckIcon />
                    </span>
                    <span>
                      <span className="dstep-name">Priset</span>
                      <span className="dstep-val">Rimligt slutpris 5,1–5,45 mkr. Räkna med budgivning.</span>
                    </span>
                    <span className="chip">Klar</span>
                  </a>
                </li>
                <li className="is-done" style={{ "--d": ".95s" } as React.CSSProperties}>
                  <a href="#kostnaden">
                    <span className="marker" aria-hidden="true">
                      <CheckIcon />
                    </span>
                    <span>
                      <span className="dstep-name">Månadskostnad</span>
                      <span className="dstep-val">19 700 kr, eller 25 600 kr vid 5 % ränta</span>
                    </span>
                    <span className="chip">Klar</span>
                  </a>
                </li>
                <li className="is-done" style={{ "--d": "1.25s" } as React.CSSProperties}>
                  <a href="#kostnaden">
                    <span className="marker" aria-hidden="true">
                      <CheckIcon />
                    </span>
                    <span>
                      <span className="dstep-name">Har du råd?</span>
                      <span className="dstep-val">Ja, även med bankens kalkylränta</span>
                    </span>
                    <span className="chip">Klar</span>
                  </a>
                </li>
              </ol>

              <div className="verdict">
                <span className="verdict-label">Din gräns i budgivningen</span>
                <span className="verdict-value">5 250 000 kr</span>
                <span className="verdict-why">Sänkt från 5,45 mkr för risken med stambytet.</span>
              </div>

              <a className="guide-progress" href="/guide">
                <span className="gp-text">
                  <strong>Köpguiden:</strong> nästa steg är budgivningen
                </span>
                <span className="gp-count">4 av 12</span>
                <span className="gp-bar" aria-hidden="true">
                  <span className="on" />
                  <span className="on" />
                  <span className="on" />
                  <span className="on" />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
              </a>

              <p className="dossier-note">
                Exempel med påhittade siffror. Kalkylen utgår från 5 250 000 kr, 85 % belåning, 3 % ränta, ränteavdrag
                och 2 % amortering.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="py-12" aria-labelledby="fragor-rubrik">
        <h2 id="fragor-rubrik" className="font-display text-3xl text-foreground md:text-4xl">
          Tre frågor du behöver svar på innan du budar.
        </h2>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <Card>
            <h3 className="mt-2 font-display text-xl text-foreground">Är föreningen frisk?</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Vi läser årsredovisningen, förklarar nyckeltalen på vanlig svenska, flaggar det som behöver förklaras, och
              tar fram frågor att ställa till styrelsen.
            </p>
            <Link to="/analysera" className="mt-4 inline-block font-medium text-primary underline underline-offset-2">
              Granska föreningen
            </Link>
          </Card>

          <Card>
            <h3 className="mt-2 font-display text-xl text-foreground">Är priset rimligt?</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Utgångspriset säger mer om mäklarens strategi än om bostadens värde. Vi jämför med vad liknande bostäder i
              området har sålts för och visar vilket slutpris som är rimligt.
            </p>
            <Link to="/vardering" className="mt-4 inline-block font-medium text-primary underline underline-offset-2">
              Kolla priset
            </Link>
          </Card>

          <Card>
            <h3 className="mt-2 font-display text-xl text-foreground">Har jag råd med just den här?</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Månadskostnaden med ränta efter avdrag, amortering, avgift och drift. Och hur mycket du har kvar i
              plånboken om räntan stiger.
            </p>
            <a href="/bolanekalkyl" className="mt-4 inline-block font-medium text-primary underline underline-offset-2">
              Räkna på månadskostnaden
            </a>
          </Card>
        </div>
      </section>

      <section className="py-12" aria-labelledby="guide-rubrik">
        <Card className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <h2 id="guide-rubrik" className="font-display text-2xl text-foreground md:text-3xl">
              Och resten av köpet? Köpguiden tar dig hela vägen.
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Tolv steg från lånelöfte till tillträde, med vad du ska se upp med och vad du gör härnäst.
            </p>
          </div>
          <LinkButton to="/guide" variant="secondary">
            Öppna köpguiden
          </LinkButton>
        </Card>
      </section>

      <section className="py-12 md:py-20" aria-labelledby="oberoende-rubrik">
        <div className="grid items-start gap-8 md:grid-cols-2 md:gap-20">
          <h2
            id="oberoende-rubrik"
            className="text-balance font-display text-4xl leading-[1.14] tracking-tight text-foreground md:text-5xl"
          >
            Vi tjänar ingenting på att du köper.
          </h2>
          <div className="max-w-[32em] space-y-4 text-muted-foreground md:text-lg">
            <p>
              Säljaren anlitar och betalar mäklaren. Banken tjänar på ditt lån. Binfo tar ingen provision från mäklare,
              banker eller föreningar.
            </p>
            <p>
              Därför kan vi säga det rakt ut när en bostad är för dyr, när en förening har problem eller när du borde
              låta bli att buda.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
