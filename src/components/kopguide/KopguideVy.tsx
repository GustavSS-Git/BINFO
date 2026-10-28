import { Link } from "@tanstack/react-router";
import { FelRuta } from "@/components/konto/AuthSida";
import { Eyebrow, LinkButton, ProgressBar, Toggle } from "@/components/ui/binfo";
import { cn } from "@/lib/utils";
import type { PropertyType } from "@/data/mockData";
import { antalKlara, nastaSteg, synligaSteg } from "@/lib/kopguide/framsteg";
import { KOPGUIDE_FASER, type KopguideSteg } from "@/lib/kopguide/steg";

const TALORD: Record<number, string> = { 12: "Tolv", 13: "Tretton" };

function Bock({ storlek = 16 }: { storlek?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={storlek}
      height={storlek}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function KopguideVy({
  typ,
  onTyp,
  klara,
  oppen,
  sparFel,
  onOppna,
  onMarkera,
  onGaTill,
}: {
  typ: PropertyType;
  onTyp: (t: PropertyType) => void;
  klara: readonly string[];
  oppen: string | null;
  sparFel: string | null;
  onOppna: (id: string | null) => void;
  onMarkera: (steg: KopguideSteg) => void;
  onGaTill: (id: string) => void;
}) {
  const synliga = synligaSteg(typ);
  const antal = antalKlara(klara, typ);
  const nasta = nastaSteg(klara, typ);
  const klart = new Set(klara);
  const stegNummer = new Map(synliga.map((s, i) => [s.id, i + 1]));

  return (
    <>
      <section className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-end justify-between gap-8 px-4 pb-10 pt-10 sm:px-8 md:pt-12">
          <div className="flex max-w-[700px] flex-col gap-3">
            <Eyebrow>Köpguide</Eyebrow>
            <h1 className="font-display text-[34px] font-semibold leading-[1.1] text-primary md:text-[44px]">
              Hela bostadsköpet, steg för steg
            </h1>
            <p className="text-lg text-text-2">
              {TALORD[synliga.length] ?? String(synliga.length)} steg från lånelöfte till tillträde.
              Klicka på ett steg för att se varningar och tips. Bocka av det du är klar med.
            </p>
            {/* Bostadstypvalet är grafiskt dolt tills vidare — fokus är bostadsrätter.
                State, funktioner och hus-stegen ligger kvar oförändrade. */}
            <div className="hidden">
              <Toggle
                value={typ}
                onChange={onTyp}
                options={[
                  { value: "brf", label: "Bostadsrätt" },
                  { value: "hus", label: "Hus" },
                ]}
              />
            </div>
          </div>
          <div className="flex w-full flex-col gap-2.5 md:w-[340px]" aria-live="polite">
            <span className="text-[15px] font-semibold text-foreground">
              {antal} av {synliga.length} steg klara
            </span>
            <ProgressBar
              andel={synliga.length === 0 ? 0 : antal / synliga.length}
              label="Steg klara i köpguiden"
            />
            {nasta !== null ? (
              <p className="text-[15px] text-text-2">
                Nästa steg:{" "}
                <a
                  href={`#steg-${nasta.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onGaTill(nasta.id);
                  }}
                  className="font-semibold text-link underline underline-offset-2"
                >
                  {nasta.titel} →
                </a>
              </p>
            ) : (
              <p className="text-[15px] font-semibold text-grade-a">
                Alla steg klara. Grattis till bostaden!
              </p>
            )}
            {sparFel !== null ? <FelRuta>{sparFel}</FelRuta> : null}
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-4 pb-24 pt-10 sm:px-8">
        {KOPGUIDE_FASER.map((fas) => {
          const fasSteg = fas.stegIds
            .map((id) => synliga.find((s) => s.id === id))
            .filter((s): s is KopguideSteg => s !== undefined);
          if (fasSteg.length === 0) return null;
          const fasKlara = fasSteg.filter((s) => klart.has(s.id)).length;
          return (
            <section
              key={fas.id}
              aria-labelledby={`fas-${fas.id}`}
              className="flex flex-col gap-3.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2
                  id={`fas-${fas.id}`}
                  className="font-display text-[28px] font-semibold text-primary"
                >
                  {fas.titel}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {fasKlara} av {fasSteg.length} klara
                </span>
              </div>
              <ol className="flex flex-col gap-3">
                {fasSteg.map((s) => {
                  const nr = stegNummer.get(s.id) ?? 0;
                  const arOppen = oppen === s.id;
                  const arKlar = klart.has(s.id);
                  return (
                    <li
                      key={s.id}
                      id={`steg-${s.id}`}
                      className={cn(
                        "scroll-mt-6 rounded-lg",
                        arKlar
                          ? "border border-success/30 bg-done-tint"
                          : arOppen
                            ? "border-2 border-primary bg-card"
                            : "border border-border bg-card",
                      )}
                    >
                      <div className="flex items-start gap-3 p-4 sm:gap-4 sm:px-6 sm:py-5">
                        <span
                          className={cn(
                            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold",
                            arKlar ? "bg-success text-white" : "bg-tint text-primary",
                          )}
                        >
                          {arKlar ? <Bock /> : nr}
                        </span>
                        <button
                          type="button"
                          aria-expanded={arOppen}
                          aria-controls={`steg-${s.id}-innehall`}
                          onClick={() => onOppna(arOppen ? null : s.id)}
                          className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
                        >
                          <span className="flex flex-col gap-1">
                            <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                              Steg {nr}
                            </span>
                            <span
                              className={cn(
                                "font-display text-[20px] font-semibold leading-tight sm:text-[22px]",
                                arKlar ? "text-muted-foreground" : "text-foreground",
                              )}
                            >
                              {s.titel}
                            </span>
                            <span className="text-[15px] text-muted-foreground">
                              {s.sammanfattning}
                            </span>
                          </span>
                          <svg
                            aria-hidden="true"
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={cn(
                              "mt-1 shrink-0 text-muted-foreground transition-transform",
                              arOppen ? "rotate-90" : "",
                            )}
                          >
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => onMarkera(s)}
                          aria-label={`${arKlar ? "Ångra" : "Markera klar"}: ${s.titel}`}
                          className="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-input bg-card px-4 text-sm font-semibold text-primary transition-colors hover:bg-tint"
                        >
                          {arKlar ? "Ångra" : "Markera klar"}
                        </button>
                      </div>

                      <div
                        id={`steg-${s.id}-innehall`}
                        hidden={!arOppen}
                        className="flex flex-col gap-4 px-4 pb-6 sm:pl-[72px] sm:pr-6"
                      >
                        <div className="border-t border-border" />
                        <p className="text-base text-foreground">{s.beskrivning}</p>
                        {s.flaggor.length > 0 ? (
                          <div className="flex flex-col gap-2.5 rounded-md border border-danger-border bg-danger-tint px-5 py-4">
                            <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-danger-text">
                              Viktiga flaggor
                            </p>
                            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] text-text-2">
                              {s.flaggor.map((f) => (
                                <li key={f}>{f}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {s.tips.length > 0 ? (
                          <div className="flex flex-col gap-2.5 rounded-md border border-success/25 bg-success-tint px-5 py-4">
                            <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-success-text">
                              Tips
                            </p>
                            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] text-text-2">
                              {s.tips.map((t, i) => (
                                <li key={i}>
                                  {t.text}
                                  {t.text !== "" && t.lank !== undefined ? " " : null}
                                  {t.lank !== undefined ? (
                                    <Link
                                      to={t.lank.to}
                                      className="font-semibold text-link underline underline-offset-2"
                                    >
                                      {t.lank.label}
                                    </Link>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}

        <section className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-lg border border-border bg-card p-5 sm:p-7">
          <div className="flex max-w-[640px] flex-col gap-1.5">
            <h2 className="text-[19px] font-semibold text-foreground">Hittat en bostad?</h2>
            <p className="text-[15px] text-text-2">
              Se vad den är värd och hur föreningen mår innan du budar.
            </p>
          </div>
          <LinkButton to="/analysera" size="lg">
            Analysera en bostad
          </LinkButton>
        </section>
      </div>
    </>
  );
}
