import {
  Badge,
  Callout,
  Card,
  Details,
  KeyValueList,
  SektionsRubrik,
  SpanBar,
  Tag,
} from "@/components/ui/binfo";
import {
  PRISEFFEKT_CAVEAT,
  RAKNA_FAKTORER,
  MODELL_FAKTORER_INTRO,
  RANTEKANSLIGHET_PRIS_RAD,
  TON_BG,
  TON_TEXT,
  VARDESPANN_PROCENT,
  avrundaKomponentEffekter,
  avrundaVardering,
  byggarPrisNotis,
  formatBudpremieText,
  formatSigneratKr,
  formatVardeAvrundat,
  formatDataperiodLang,
  formatVardespann,
  kvmPrisForVardering,
  KOMPONENT_KORTNAMN,
  komponentPris,
  lageMotVardespann,
  medVersal,
  modellVersionText,
  prisEffektTexter,
  prisRubrik,
  rapportOmrade,
  vardespann,
  varderingsKallaText,
  varderingsTackningText,
  vattenfall,
  visatVarde,
  type AndelAvSkuldRad,
  type VattenfallRad,
} from "@/lib/analysisView";
import { formatMkr, formatSpannMkr, iEllerPaOmrade, kvmPris, vanligtBud } from "@/lib/prisVy";
import { kr } from "@/data/mockData";
import type {
  AnalysisResult,
  Avgiftsprognos,
  Faltjamforelse,
  PrisanalysUtanForening,
  PropertyInput,
} from "@/types/analysis";

const LAGE_TEXT = { under: "under spannet", inom: "inom spannet", over: "över spannet" } as const;

/** Stapeldiagram från "liknande lägenheter" till det justerade värdet (bara i "Så har vi räknat"). */
function PrisVattenfall({
  prisanalys,
  prognos,
}: {
  prisanalys: PrisanalysUtanForening;
  prognos: Avgiftsprognos;
}) {
  const v = vattenfall(prisanalys, prognos);
  if (!v) return null;
  return (
    <div className="rounded-lg border border-border p-4" data-slot="pris-vattenfall">
      <p className="mb-4 border-b border-divider pb-2 text-[13px] font-semibold text-muted-foreground">
        Så påverkar föreningens ekonomi priset
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {v.rader.map((r: VattenfallRad) => (
          <li
            key={r.id}
            className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,10rem)_1fr_auto] sm:gap-3"
          >
            <span className="min-w-0 text-[13px] text-foreground">{r.label}</span>
            <span className="relative h-3 rounded-sm bg-track" aria-hidden>
              <span
                data-ton={r.ton}
                className={`absolute inset-y-0 rounded-sm ${r.typ === "steg" ? TON_BG[r.ton] : "bg-muted-foreground"}`}
                style={{ left: `${r.vansterPct}%`, width: `${r.breddPct}%` }}
              />
            </span>
            <span
              className={`text-right text-[13px] font-semibold ${r.typ === "steg" ? TON_TEXT[r.ton] : "text-foreground"}`}
            >
              {r.beloppText}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Skalan är utzoomad kring värdena.
        {v.proportionell ? " Delbeloppen är fördelade efter komponenternas kr/mån." : ""}
      </p>
    </div>
  );
}

function spannEtikett(
  lag: number,
  hog: number,
  utg: number | null,
  bud: number | null,
  bas: number | null,
  visat: number,
  lage: "under" | "inom" | "over" | null,
  budLage: "under" | "inom" | "over" | null,
): string {
  const mkr = (kr: number) =>
    (kr / 1_000_000).toLocaleString("sv-SE", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    });
  const delar = [
    `Värdespann ${mkr(lag)} till ${mkr(hog)} miljoner kronor, Binfos värdering plus minus ${VARDESPANN_PROCENT} procent.`,
    `Binfos värdering ${mkr(avrundaVardering(visat))} miljoner.`,
  ];
  if (utg !== null && lage)
    delar.push(`Utgångspriset ${mkr(utg)} miljoner ligger ${LAGE_TEXT[lage]}.`);
  if (bud !== null && budLage) {
    delar.push(`Ett vanligt bud, ${mkr(bud)} miljoner, ligger ${LAGE_TEXT[budLage]}.`);
  }
  if (bas !== null) delar.push(`Liknande lägenheter säljs för ${mkr(bas)} miljoner.`);
  return delar.join(" ");
}

/**
 * Avsnitt 2, "Priset": verdikt, spannet som stapel, annonsens pris mot Binfos värdering
 * och "Så har vi räknat". Varje värde kommer ur analysens `prisanalys`.
 */
export function PrisSektion({
  prisanalys: p,
  input,
  avgiftsprognos,
  skuldrad,
  byggarJamforelse,
}: {
  prisanalys: AnalysisResult["prisanalys"];
  input: Pick<PropertyInput, "boarea" | "postnummer">;
  avgiftsprognos: Avgiftsprognos | undefined;
  skuldrad: AndelAvSkuldRad | undefined;
  byggarJamforelse: Faltjamforelse | undefined;
}) {
  const u = p.varderingsunderlag;
  const tackning = u ? varderingsTackningText(u) : null;
  const visat = visatVarde(p);
  const utgangspris = p.utgangspris?.value ?? null;
  const bud = vanligtBud(utgangspris, p.budpremie);
  const lage = visat && utgangspris !== null ? lageMotVardespann(utgangspris, visat.exakt) : null;
  const budLage = visat && bud !== null ? lageMotVardespann(bud, visat.exakt) : null;
  const bas = p.externVardering?.value ?? null;
  const harJusterat = visat?.kalla === "justerad" && bas !== null;
  const liknandeSkiljer =
    harJusterat && bas !== null && avrundaVardering(bas) !== avrundaVardering(visat.exakt);
  const omrade = rapportOmrade(u) ?? u?.prisniva?.region;
  const byggarNotis = byggarPrisNotis(byggarJamforelse);
  const spann = visat ? vardespann(visat.exakt) : null;
  const budpremieOmrade = p.budpremie ? (p.budpremie.omrade ?? "Stockholm") : null;
  const procentSigned = p.budpremie
    ? Math.abs(p.budpremie.medianProcent).toLocaleString("sv-SE", { maximumFractionDigits: 1 })
    : "";

  const lead = visat
    ? `Spannet är Binfos värdering ± ${VARDESPANN_PROCENT} %, alltså ${formatSpannMkr(visat.exakt)}.${
        budLage ? ` Ett vanligt bud för området hamnar ${LAGE_TEXT[budLage]}.` : ""
      }${utgangspris === null && p.budpremie ? ` ${formatBudpremieText(p.budpremie)}` : ""}`
    : "Utan ett giltigt postnummer kan Binfo inte värdera lägenheten.";

  // Komponenternas effekter på priset, avrundade till 1 000 kr så att de summerar till totalen.
  const justering = p.justeringar?.find((x) => x.id === "forvantad_avgiftshojning");
  const ekonomi = (() => {
    if (!avgiftsprognos || !justering || justering.belopp.value === null) return null;
    const { bidrag } = komponentPris(p, avgiftsprognos);
    const { effekter, total } = avrundaKomponentEffekter(bidrag, justering.belopp.value);
    const delar = avgiftsprognos.komponenter
      .filter((k) => effekter[k.id] !== undefined && effekter[k.id] !== 0)
      .map((k) => `${KOMPONENT_KORTNAMN[k.id]} ${formatSigneratKr(effekter[k.id] ?? 0)}`);
    return {
      text: medVersal(delar.join(" · ")),
      total: formatSigneratKr(total),
    };
  })();

  const kvmRad = (varde: number | null | undefined) => {
    const text = kvmPrisForVardering(varde, input.boarea);
    return text ?? undefined;
  };

  return (
    <section className="flex flex-col gap-7">
      <SektionsRubrik
        id="priset"
        nummer="2"
        eyebrow="Priset"
        titel={prisRubrik(lage)}
        lead={lead}
      />

      {tackning ? (
        tackning.typ === "utanfor_lan" ? (
          <Callout variant="flag" title={tackning.titel ?? "Utanför täckningsområdet"}>
            <p>{tackning.text}</p>
          </Callout>
        ) : (
          <Callout variant="notice" title="Värdering utanför Stockholms kommun">
            <p>{tackning.text}</p>
          </Callout>
        )
      ) : null}

      <Card className="flex flex-col gap-8">
        {visat && spann ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-[19px] font-semibold text-foreground">Rimligt prisspann</h3>
            <p className="text-[15px] text-muted-foreground">
              Binfos värdering ± {VARDESPANN_PROCENT} %
              {utgangspris !== null ? ", och var utgångspriset" : ""}
              {bud !== null ? " och ett vanligt bud hamnar" : utgangspris !== null ? " hamnar" : ""}
            </p>
            <SpanBar
              lag={spann.low}
              hog={spann.high}
              ariaLabel={spannEtikett(
                spann.low,
                spann.high,
                utgangspris,
                bud,
                liknandeSkiljer ? avrundaVardering(bas ?? 0) : null,
                visat.exakt,
                lage,
                budLage,
              )}
              markorer={[
                ...(utgangspris !== null
                  ? [
                      {
                        label: "Utgångspris",
                        varde: utgangspris,
                        text: formatMkr(utgangspris, 2),
                        ton: "utgangspris" as const,
                      },
                    ]
                  : []),
                ...(bud !== null
                  ? [
                      {
                        label: "Vanligt bud",
                        varde: bud,
                        text: formatMkr(bud, 2),
                        ton: "bud" as const,
                      },
                    ]
                  : []),
                {
                  label: "Binfos värdering",
                  varde: avrundaVardering(visat.exakt),
                  text: formatMkr(avrundaVardering(visat.exakt), 2),
                  ton: "vardering" as const,
                },
                ...(liknandeSkiljer && bas !== null
                  ? [
                      {
                        label: "Liknande lägenheter",
                        varde: avrundaVardering(bas),
                        text: formatMkr(avrundaVardering(bas), 2),
                        ton: "liknande" as const,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <h3 className="text-[19px] font-semibold text-foreground">Binfos värdering</h3>
            <p className="text-[15px] text-text-2">
              Inte tillgänglig — postnumret saknas eller är ogiltigt
            </p>
          </div>
        )}

        <div className={`grid gap-8 ${utgangspris !== null ? "md:grid-cols-2" : ""}`}>
          {utgangspris !== null ? (
            <div>
              <h3 className="mb-2 text-[19px] font-semibold text-foreground">Priset i annonsen</h3>
              <KeyValueList
                rader={[
                  {
                    label: "Utgångspris",
                    varde: kr(utgangspris),
                    ...(kvmPris(utgangspris, input.boarea)
                      ? { undertext: kvmPris(utgangspris, input.boarea) }
                      : {}),
                  },
                  ...(bud !== null && p.budpremie
                    ? [
                        {
                          label: "Vanlig budnivå i området",
                          note: `Utgångspriset ${p.budpremie.medianProcent < 0 ? "minus" : "plus"} ${procentSigned} %, vad bostäder ${iEllerPaOmrade(p.budpremie.omrade)} brukar gå för ${p.budpremie.medianProcent < 0 ? "under" : "över"} utgångspris`,
                          varde: `ca ${kr(bud)}`,
                          ...(kvmPris(bud, input.boarea)
                            ? { undertext: kvmPris(bud, input.boarea) }
                            : {}),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          ) : null}

          <div>
            <h3 className="mb-2 text-[19px] font-semibold text-foreground">Binfos värdering</h3>
            {/* Dold rad (ägarens beslut 2026-10-09): leverantören av värderingen visas inte. */}
            {p.externVardering ? (
              <p className="hidden text-xs text-muted-foreground">{p.externVardering.leverantor}</p>
            ) : null}
            {visat ? (
              <KeyValueList
                rader={[
                  ...(bas !== null
                    ? [
                        {
                          label: `Vad liknande lägenheter säljs för${omrade ? ` (${omrade}${input.postnummer ? `, ${input.postnummer.replace(/ /g, "\u00a0")}` : ""})` : ""}`,
                          ...(u
                            ? {
                                note: `Binfos värderingsmodell, tränad på bostadsrättsförsäljningar i Stockholm ${formatDataperiodLang(u.dataperiod)} med data från Svensk Mäklarstatistik.`,
                              }
                            : {}),
                          varde: `ca ${formatVardeAvrundat(bas)}`,
                          ...(kvmRad(bas) ? { undertext: kvmRad(bas) } : {}),
                        },
                      ]
                    : []),
                  ...(harJusterat && ekonomi
                    ? [
                        {
                          label: "Föreningens ekonomi",
                          note: ekonomi.text,
                          varde: ekonomi.total,
                        },
                      ]
                    : []),
                  {
                    label: "Binfos värdering",
                    note: harJusterat
                      ? "Med föreningens ekonomi inräknad"
                      : "Utan justering för föreningens ekonomi",
                    varde: `ca ${formatVardeAvrundat(visat.exakt)}`,
                    ...(kvmRad(visat.exakt) ? { undertext: kvmRad(visat.exakt) } : {}),
                    ton: "total" as const,
                  },
                  {
                    label: "Rimligt prisspann",
                    note: `Binfos värdering ± ${VARDESPANN_PROCENT} %`,
                    varde: formatVardespann(visat.exakt),
                    undertext: spannKvm(spann, input.boarea),
                  },
                ]}
              />
            ) : (
              <p className="text-[15px] text-text-2">
                Inte tillgänglig — postnumret saknas eller är ogiltigt
              </p>
            )}
          </div>
        </div>

        {byggarNotis ? (
          <p
            className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground"
            data-slot="pris-byggar"
          >
            {byggarNotis.text}
            {byggarNotis.sida ? <Tag>{byggarNotis.sida}</Tag> : null}
          </p>
        ) : null}

        {skuldrad ? (
          <p className="flex flex-wrap items-center gap-2 text-[15px] text-text-2">
            {skuldrad.text}
            {skuldrad.ref ? (
              <span title={skuldrad.ref.excerpt}>
                <Tag>s. {skuldrad.ref.page}</Tag>
              </span>
            ) : null}
            {skuldrad.osaker ? (
              <span title={skuldrad.osaker}>
                <Badge tone="warning">Osäker</Badge>
              </span>
            ) : null}
          </p>
        ) : null}

        {p.konfidens.niva === "lag" && p.konfidens.skal && p.konfidens.skal.length > 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Låg tillförlitlighet: {p.konfidens.skal.join(" ")}
          </p>
        ) : null}
      </Card>

      {u || avgiftsprognos ? (
        <Details summary="Så har vi räknat">
          <div className="flex flex-col gap-6">
            {u ? (
              <div className="flex flex-col gap-2">
                <h4 className="text-base font-semibold text-foreground">Värderingsmodellen</h4>
                <p>
                  Binfos värderingsmodell (version {modellVersionText(u.modellVersion)}) bygger på
                  tidigare försäljningar av bostadsrätter. {MODELL_FAKTORER_INTRO}
                </p>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                  {RAKNA_FAKTORER.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <p>{varderingsKallaText(u.dataperiod)}</p>
                {visat ? (
                  <p>
                    Spannet {formatSpannMkr(visat.exakt)} är Binfos värdering ± {VARDESPANN_PROCENT}{" "}
                    %. Det visar hur långt från värderingen ett pris kan ligga och ändå vara
                    rimligt, och är inget statistiskt konfidensintervall.
                  </p>
                ) : null}
                <p>
                  Modellens typiska fel{omrade ? ` i ${omrade}` : ""} är ca{" "}
                  {u.typisktFelProcent.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %.
                </p>
                <p>{p.slutsats}</p>
              </div>
            ) : null}
            {avgiftsprognos && p.justeradVardering ? (
              <div className="flex flex-col gap-3">
                <h4 className="text-base font-semibold text-foreground">
                  Hur föreningens ekonomi påverkar priset
                </h4>
                {prisEffektTexter(p).map((t) => (
                  <p key={t}>{t}</p>
                ))}
                <p>{RANTEKANSLIGHET_PRIS_RAD}</p>
                <p className="text-[13px] text-muted-foreground">{PRISEFFEKT_CAVEAT}</p>
                {/* Exact kronor live only here, in the method layer (owner 2026-10-26). */}
                <PrisVattenfall prisanalys={p} prognos={avgiftsprognos} />
              </div>
            ) : null}
          </div>
        </Details>
      ) : null}
    </section>
  );
}

function spannKvm(spann: { low: number; high: number } | null, boarea: number): string | undefined {
  if (!spann || !(boarea > 0)) return undefined;
  const per = (v: number) => (Math.round(v / boarea / 100) * 100).toLocaleString("sv-SE");
  return `${per(spann.low)} – ${per(spann.high)} kr/m²`;
}
