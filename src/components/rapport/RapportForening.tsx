import {
  Badge,
  Callout,
  Card,
  DataTable,
  Details,
  SektionsRubrik,
  StatusPill,
  Tag,
} from "@/components/ui/binfo";
import {
  SKANNAD_NOTIS,
  arOgraderatNyckeltal,
  arSkannad,
  avgiftIngarText,
  foreningFaktaText,
  foreningenRubrik,
  formatFigureVarde,
  nyckeltalJamforelse,
  sorteraNyckeltal,
  toppRodaFlaggor,
  visasNyckeltal,
} from "@/lib/analysisView";
import type { AnalysisResult, Severity } from "@/types/analysis";

const SIDA = "whitespace-nowrap text-[13px] text-muted-foreground";

const severityLabel: Record<Severity, string> = {
  hog: "hög risk",
  medel: "medelrisk",
  lag: "låg risk",
};

type ForeningData = Pick<
  AnalysisResult,
  "betyg" | "betygMotivering" | "rodaFlaggor" | "forening"
> & {
  datakvalitet: Pick<AnalysisResult["datakvalitet"], "extraktionKonfidens" | "kalla">;
};

/**
 * Avsnitt 1, "Föreningen": rubrik, "Att hålla koll på", de sju nyckeltalen och "Mer ur
 * årsredovisningen". Delas av rapporten och den sparade BRF-analysen i registret (som
 * inte har köparens uppgifter och därför inte har `sparbehovMal`).
 */
export function ForeningSektion({
  analys,
  sparbehovMal,
  visaLead = true,
}: {
  analys: ForeningData;
  /** Husets sparbehov (kr/m²) ur avgiftsprognosen, för jämförelsen vid sparande. */
  sparbehovMal?: number | undefined;
  /** Registersidan visar motiveringen i ett eget betygskort och utelämnar ingressen. */
  visaLead?: boolean;
}) {
  const flaggor = toppRodaFlaggor(analys.rodaFlaggor, 2);
  const nyckeltal = sorteraNyckeltal(analys.forening.keyFigures.filter(visasNyckeltal));
  const skannad = arSkannad(analys);

  return (
    <section className="flex flex-col gap-7">
      <SektionsRubrik
        id="foreningen"
        nummer="1"
        eyebrow="Föreningen"
        titel={foreningenRubrik(analys.betyg, flaggor.length)}
        {...(visaLead ? { lead: analys.betygMotivering } : {})}
      />

      {flaggor.length > 0 ? (
        <ul className="m-0 grid list-none gap-5 p-0 md:grid-cols-2">
          {flaggor.map((flagga) => (
            <li key={flagga.id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <StatusPill
                    tone={flagga.severity === "hog" ? "danger" : "warning"}
                    label={
                      <>
                        Att hålla koll på
                        <span className="sr-only"> ({severityLabel[flagga.severity]})</span>
                      </>
                    }
                  />
                  {flagga.ref ? (
                    <span className={SIDA} title={flagga.ref.excerpt}>
                      s. {flagga.ref.page}
                    </span>
                  ) : null}
                </div>
                <h3 className="text-[19px] font-semibold leading-snug text-foreground">
                  {flagga.titel}
                </h3>
                <p className="text-[15px] text-text-2">{flagga.beskrivning}</p>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      {skannad ? (
        <Callout variant="notice" title="Skannad årsredovisning">
          <p>{SKANNAD_NOTIS}</p>
        </Callout>
      ) : null}

      <DataTable caption="De sju nyckeltalen" minWidth={760}>
        <thead>
          <tr>
            <th scope="col">Nyckeltal</th>
            <th scope="col">Värde</th>
            <th scope="col">Bedömning</th>
            <th scope="col">Jämförelse</th>
            <th scope="col">Källa</th>
          </tr>
        </thead>
        <tbody>
          {nyckeltal.map((kf) => {
            const ograderat = arOgraderatNyckeltal(kf);
            const jamforelse = nyckeltalJamforelse(kf, sparbehovMal);
            return (
              <tr key={kf.id}>
                <th scope="row">
                  {kf.label}
                  <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">
                    {kf.forklaring}
                  </span>
                </th>
                <td className="whitespace-nowrap font-semibold">
                  {formatFigureVarde(kf.figure)}
                  {kf.figure.osaker ? (
                    <span className="ml-2" title={kf.figure.osaker}>
                      <Badge tone="warning">Osäker</Badge>
                    </span>
                  ) : null}
                </td>
                <td>
                  <StatusPill status={ograderat ? "okant" : kf.status} />
                </td>
                <td className="text-muted-foreground">{jamforelse}</td>
                <td>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {kf.figure.ref ? (
                      <span className={SIDA} title={kf.figure.ref.excerpt}>
                        s. {kf.figure.ref.page}
                      </span>
                    ) : null}
                    {kf.figure.source === "schablon" ? <Tag>Schablon</Tag> : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>

      <MerUrArsredovisningen analys={analys} />
    </section>
  );
}

/** "Mer ur årsredovisningen": händelser, vad som ingår i avgiften och föreningens antal. */
function MerUrArsredovisningen({ analys }: { analys: ForeningData }) {
  const f = analys.forening;
  const handelser = f.vasentligaHandelser ?? [];
  const ingar = avgiftIngarText(f);
  const fakta = foreningFaktaText(f);
  const skal = analys.datakvalitet.extraktionKonfidens.skal ?? [];
  if (handelser.length === 0 && !ingar && !fakta && skal.length === 0) return null;

  return (
    <Details summary="Mer ur årsredovisningen: händelser, vad som ingår i avgiften, antal lägenheter">
      <div className="grid gap-8 md:grid-cols-2">
        {handelser.length > 0 ? (
          <div>
            <h3 className="mb-2 text-base font-semibold text-foreground">Väsentliga händelser</h3>
            <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">
              {handelser.map((h, i) => (
                <li key={`handelse-${i}`}>
                  {h.text}{" "}
                  {h.ref ? (
                    <span className={SIDA} title={h.ref.excerpt}>
                      (s. {h.ref.page})
                    </span>
                  ) : (
                    <span className="text-[13px] italic text-muted-foreground">
                      (ingen exakt sidhänvisning)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {ingar || fakta ? (
          <div className="flex flex-col gap-4">
            {ingar ? (
              <div>
                <h3 className="mb-2 text-base font-semibold text-foreground">I avgiften</h3>
                <p>{ingar}</p>
              </div>
            ) : null}
            {fakta ? (
              <div>
                <h3 className="mb-2 text-base font-semibold text-foreground">Föreningen</h3>
                <p>{fakta}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {skal.length > 0 ? (
        <div className="mt-6 border-t border-divider pt-5">
          <h3 className="mb-2 text-base font-semibold text-foreground">
            Om extraktionens tillförlitlighet
          </h3>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
            {skal.map((s, i) => (
              <li key={`skal-${i}`}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Details>
  );
}
