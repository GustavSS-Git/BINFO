import { useId, useState } from "react";
import {
  Callout,
  Card,
  DataTable,
  Details,
  KeyValueList,
  SektionsRubrik,
  StatusPill,
  Tag,
  Toggle,
} from "@/components/ui/binfo";
import {
  BYGGDEL_KALLA_RAD,
  ENERGI_TEXT,
  REFI_FASTRAD,
  TON_BG,
  TON_TEXT,
  TRYCK_ETIKETT,
  TRYCK_TON,
  antagenAndelText,
  antalIOrd,
  avgiftLead,
  avgiftRubrik,
  byggdelNot,
  byggdelTabell,
  drivareRader,
  formatForandringKr,
  formatProcentTal,
  horisontText,
  formatSigneratKr,
  lanKallaText,
  lanTabell,
  rantestressVy,
  refiKomponent,
  referensrantaRad,
  refinansieringRader,
  sparKomponent,
  sparRader,
  type RantestressFlik,
  type Ton,
} from "@/lib/analysisView";
import { kr } from "@/data/mockData";
import type { AnalysisResult } from "@/types/analysis";

const SIDA = "whitespace-nowrap text-[13px] text-muted-foreground";

/** Färgprick (med dold text) för avgiftstryck. */
function Prick({ ton, etikett }: { ton: Ton; etikett: string }) {
  return (
    <>
      <span
        data-ton={ton}
        className={`inline-block size-2.5 shrink-0 rounded-full ${TON_BG[ton]}`}
        aria-hidden
      />
      <span className="sr-only">{etikett}</span>
    </>
  );
}

/** Dagens/förväntad avgift, reglaget för ränteökning och de två avgifterna. */
function Rantereglage({ analys }: { analys: AnalysisResult }) {
  const reglageId = useId();
  const [delta, setDelta] = useState<0 | 1 | 2 | 3>(1);
  const [flik, setFlik] = useState<RantestressFlik>("idag");
  // Räntekänslighet saknas -> reglaget visas men är låst på +0 (se Rantestress i
  // src/types/analysis.ts). Flikarna visas bara när rapporten har en förväntad avgift.
  const vy = rantestressVy(analys, flik, delta);
  const { ejBeraknbar, visadDelta, vanster, hoger } = vy;

  return (
    <Card className="flex flex-col gap-6">
      {vy.harPrognos ? (
        <div>
          <Toggle<RantestressFlik>
            ariaLabel="Utgå från"
            options={[
              { value: "idag", label: "Dagens avgift" },
              { value: "forvantad", label: "Förväntad avgift" },
            ]}
            value={vy.flik}
            onChange={setFlik}
          />
        </div>
      ) : null}
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor={reglageId} className="text-base font-semibold text-foreground">
            Räntehöjning för föreningen
          </label>
          <span className="font-display text-2xl font-semibold text-primary">
            +{visadDelta} p.e.
          </span>
        </div>
        <input
          id={reglageId}
          type="range"
          min={0}
          max={3}
          step={1}
          value={visadDelta}
          disabled={ejBeraknbar}
          onChange={(e) => setDelta(Number(e.target.value) as 0 | 1 | 2 | 3)}
          className={`mt-3 w-full accent-primary ${ejBeraknbar ? "cursor-not-allowed opacity-60" : ""}`}
        />
        <div className="mt-1 flex justify-between text-[13px] text-muted-foreground" aria-hidden>
          <span>0</span>
          <span>+1</span>
          <span>+2</span>
          <span>+3</span>
        </div>
      </div>
      {ejBeraknbar ? (
        <p className="text-[15px] text-muted-foreground">
          Räntekänslighet saknas i årsredovisningen, så avgiftsstressen kan inte beräknas.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-5">
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            {vanster.tryck ? (
              <Prick ton={TRYCK_TON[vanster.tryck]} etikett={TRYCK_ETIKETT[vanster.tryck]} />
            ) : null}
            {vanster.etikett}
          </span>
          <span className="font-display text-3xl font-semibold text-foreground">
            {vanster.varde}
          </span>
          <span className="text-[13px] text-muted-foreground">{vanster.under}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg bg-tint p-5">
          <span className="text-[13px] font-semibold text-primary">Med högre ränta</span>
          {"saknas" in hoger ? (
            <span className="text-[15px] text-foreground">{hoger.saknas}</span>
          ) : (
            <>
              <span className="font-display text-3xl font-semibold text-foreground">
                {hoger.varde}
              </span>
              <span className="text-[13px] text-muted-foreground">{hoger.under}</span>
            </>
          )}
        </div>
      </div>
      <p className="text-[15px] text-text-2">{vy.kommentar}</p>
    </Card>
  );
}

/** Det som driver den förväntade avgiften: komponenter, byggdelar, sparande och lån. */
function DrivareDetaljer({ analys }: { analys: AnalysisResult }) {
  const prognos = analys.avgiftsprognos;
  if (!prognos) return null;
  const dagens = analys.rantestress.nuvarandeManadsavgift.value;
  const total = prognos.totalKrPerManad;
  const tid = horisontText(prognos.horisontManader);
  const forvantad = dagens !== null && total !== null ? Math.round(dagens + total) : null;
  const rader = drivareRader(prognos);
  const sb = prognos.sparbehov;
  const sparrader = sparRader(prognos);
  const byggdelar = sb ? byggdelTabell(sb) : [];
  const refi = prognos.refinansiering;
  const refiKomp = refiKomponent(prognos);
  const lan = refi ? lanTabell(refi, prognos.horisontManader) : [];
  const omsatta = (refi?.lan ?? []).filter((l) => l.fas === "forfallit").length;
  const spar = sparKomponent(prognos);

  return (
    <Details
      summary="Det här driver den förväntade avgiften"
      {...(forvantad !== null && total !== null
        ? {
            meta: `ca ${kr(forvantad)} om ${tid} (${formatForandringKr(total)})`,
          }
        : {})}
    >
      <div className="flex flex-col gap-8">
        <DataTable caption="Det här driver den förväntade avgiften" minWidth={300}>
          <thead>
            <tr>
              <th scope="col">Drivare</th>
              <th scope="col">Effekt på din avgift</th>
            </tr>
          </thead>
          <tbody>
            {rader.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  {r.label}
                  <span className="mt-0.5 block max-w-[560px] text-[13px] font-normal text-muted-foreground">
                    {r.forklaring}
                    {r.ref ? (
                      <>
                        {" "}
                        <span className={SIDA} title={r.ref.excerpt}>
                          (s. {r.ref.page})
                        </span>
                      </>
                    ) : null}
                  </span>
                </th>
                <td
                  data-ton={r.ton}
                  className={`whitespace-nowrap font-semibold ${r.dimmad ? "text-muted-foreground" : TON_TEXT[r.ton]}`}
                >
                  {r.varde}
                  {r.tryck ? <span className="sr-only"> ({TRYCK_ETIKETT[r.tryck]})</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
          {forvantad !== null && total !== null ? (
            <tfoot>
              <tr className="border-t border-divider">
                <th scope="row" className="px-3 py-3.5 pl-4 text-left font-semibold sm:pl-7">
                  Förväntad avgift om {tid}
                </th>
                <td className="whitespace-nowrap px-3 py-3.5 pr-4 font-semibold text-primary sm:pr-7">
                  ca {kr(forvantad)}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({formatForandringKr(total)})
                  </span>
                </td>
              </tr>
            </tfoot>
          ) : null}
        </DataTable>
        <p className="text-[13px] text-muted-foreground">{ENERGI_TEXT}</p>

        {sparrader ? (
          <div className="flex flex-col gap-3">
            <h4 className="text-base font-semibold text-foreground">
              {byggdelar.length > 0 ? "Husets byggdelar" : "Sparande mot underhållsbehov"}
              {byggdelar.length > 0 ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · förklarar underhållsbehovet bakom sparandet
                </span>
              ) : null}
              {spar?.tryck ? (
                <span className="ml-2 inline-flex items-center gap-2 align-middle">
                  <Prick ton={TRYCK_TON[spar.tryck]} etikett={TRYCK_ETIKETT[spar.tryck]} />
                </span>
              ) : null}
            </h4>
            {byggdelar.length > 0 ? (
              <>
                <DataTable minWidth={560}>
                  <thead>
                    <tr>
                      <th scope="col">Byggdel</th>
                      <th scope="col">Senast åtgärdad</th>
                      <th scope="col">Brukar hålla</th>
                      <th scope="col">Läge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byggdelar.map((b) => (
                      <tr key={b.key}>
                        <th scope="row">{b.label}</th>
                        <td>
                          {b.senast}
                          {b.sida !== undefined ? (
                            <>
                              {" "}
                              <span className={SIDA} title={b.excerpt}>
                                (s. {b.sida})
                              </span>
                            </>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap">{b.livslangd}</td>
                        <td>
                          <StatusPill tone={b.lage.ton} label={b.lage.text} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                <p className="text-[13px] text-muted-foreground">
                  {BYGGDEL_KALLA_RAD} {byggdelNot()}
                </p>
              </>
            ) : null}
            <KeyValueList
              rader={sparrader.map((r) => ({
                label: r.label,
                note: r.note,
                varde: r.varde,
                ...(r.total ? { ton: "total" as const } : {}),
              }))}
            />
          </div>
        ) : null}

        {refi || refiKomp ? (
          <div className="flex flex-col gap-3">
            <h4 className="text-base font-semibold text-foreground">
              Föreningens lån
              <span className="font-normal text-muted-foreground">
                {" "}
                · förklarar raden om lån som läggs om
              </span>
            </h4>
            {lan.length > 0 ? (
              <DataTable minWidth={560}>
                <thead>
                  <tr>
                    <th scope="col">Förfaller</th>
                    <th scope="col">Belopp</th>
                    <th scope="col">Ränta i årsredovisningen</th>
                    <th scope="col">Läge</th>
                  </tr>
                </thead>
                <tbody>
                  {lan.map((l) => (
                    <tr key={l.key}>
                      <th scope="row">{l.forfaller}</th>
                      <td className="whitespace-nowrap">{l.belopp}</td>
                      <td className="whitespace-nowrap">{l.ranta}</td>
                      <td>
                        <StatusPill tone={l.lage.ton} label={l.lage.text} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : null}
            {refi ? (
              <>
                <p className="text-[13px] text-muted-foreground">
                  {referensrantaRad(refi)}.{lanKallaText(refi) ? ` ${lanKallaText(refi)}` : ""}
                </p>
                {lan.some((l) => l.lage.text.startsWith("År ")) ? (
                  <p className="text-[13px] text-muted-foreground">{REFI_FASTRAD}</p>
                ) : null}
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-text-2">
                  {refinansieringRader(refi).map((rad) => (
                    <li key={rad.label}>
                      <span className="text-muted-foreground">{rad.label}:</span> {rad.value}
                    </li>
                  ))}
                </ul>
                {antagenAndelText(refi) ? (
                  <p className="text-[13px] text-muted-foreground">{antagenAndelText(refi)}</p>
                ) : null}
              </>
            ) : null}
            {refiKomp ? (
              <KeyValueList
                rader={[
                  ...(refi && refiKomp.foreningKrPerAr !== null
                    ? [
                        {
                          label: "Förväntad förändring i föreningens årliga räntekostnader",
                          note: `Om lånen som förfaller inom ${tid} får ca ${formatProcentTal(refi.nyRantaProcent)}.${
                            omsatta > 0
                              ? ` ${omsatta === 1 ? "Ett lån är" : `${antalIOrd(omsatta)} lån är`} redan omsatt till okänd ränta.`
                              : ""
                          }`,
                          varde: `ca ${formatSigneratKr(refiKomp.foreningKrPerAr, "kr per år")}`,
                        },
                      ]
                    : []),
                  ...(refiKomp.krPerManad !== null
                    ? [
                        {
                          label: "Din andel",
                          note: `Det här är raden ”${refiKomp.label}” i den förväntade avgiften`,
                          varde: `ca ${formatSigneratKr(refiKomp.krPerManad, "kr/mån")}`,
                          ton: "total" as const,
                        },
                      ]
                    : []),
                ]}
              />
            ) : null}
            {refiKomp?.ref ? (
              <span title={refiKomp.ref.excerpt}>
                <Tag>Årsredovisning s. {refiKomp.ref.page}</Tag>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Details>
  );
}

/** Avsnitt 3, "Avgiften framåt". */
export function AvgiftSektion({ analys }: { analys: AnalysisResult }) {
  const prognos = analys.avgiftsprognos;
  return (
    <section className="flex flex-col gap-7">
      <SektionsRubrik
        id="avgiften"
        nummer="3"
        eyebrow="Avgiften framåt"
        titel={avgiftRubrik(prognos)}
        lead={avgiftLead(prognos)}
      />
      {prognos?.tryck ? (
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={TRYCK_TON[prognos.tryck]} label={TRYCK_ETIKETT[prognos.tryck]} />
          <Tag>Uppskattning</Tag>
        </div>
      ) : null}
      {prognos?.osaker ? (
        <Callout variant="notice" title="Osäker uppskattning">
          <p>{prognos.osaker}</p>
        </Callout>
      ) : null}
      <Rantereglage analys={analys} />
      <DrivareDetaljer analys={analys} />
    </section>
  );
}
