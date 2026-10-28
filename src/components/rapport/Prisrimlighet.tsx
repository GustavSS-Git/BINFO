import { useState, type ReactNode } from "react";
import { Callout, Card, Badge, SectionTitle, Tag } from "@/components/ui/binfo";
import {
  formatBudpremieText,
  varderingsKallaText,
  varderingsTackningText,
  formatFigureVarde,
  formatVardeFigurAvrundat,
  kvmPrisForVardering,
  formatVardespann,
  visatVarde,
  VARDESPANN_LABEL,
  type AndelAvSkuldRad,
  antagenAndelText,
  avgiftsHuvud,
  prisAvvikelseRad,
  BYGGDEL_KALLA_TEXT,
  byggdelNot,
  byggdelRader,
  ENERGI_TEXT,
  FORFALLIT_LAN_TEXT,
  komponentKalla,
  komponentRader,
  lanRader,
  prisEffektTexter,
  PRIS_LABEL_BAS,
  PRIS_LABEL_JUSTERAD,
  byggarPrisNotis,
  PRISEFFEKT_CAVEAT,
  RAKNA_FAKTORER,
  RAKNA_PROGNOS_RUBRIK,
  RAKNA_UTGANGSLAGE_INTRO,
  RAKNA_UTGANGSLAGE_KORT,
  RAKNA_UTGANGSLAGE_RUBRIK,
  RANTEKANSLIGHET_RAD,
  referensrantaRad,
  refinansieringRader,
  refiKomponent,
  REFI_FASTRAD,
  sparKedja,
  sparKomponent,
  TON_BG,
  TON_TEXT,
  tonForTryck,
  TRYCK_ETIKETT,
  TRYCK_TON,
  vattenfall,
  type Ton,
  type VattenfallRad,
} from "@/lib/analysisView";
import type {
  Avgiftsprognos,
  Faltjamforelse,
  Figure,
  PrisanalysUtanForening,
} from "@/types/analysis";

/*
 * Prisrimlighet i sin gamla form. Används kvar av Priskollen på /analysera och av
 * SparadVardering tills de byter till PriskollResultat; rapporten själv använder
 * RapportPris. Rör inte utan att kontrollera de två anropsplatserna.
 */

/** "Osäker"-markering på en uppgift som rimlighetskontrollerna stämplat. */
function OsakerMarkering({ figure }: { figure: Pick<Figure, "osaker"> }) {
  if (!figure.osaker) return null;
  return (
    <span title={figure.osaker}>
      <Badge tone="warning">Osäker</Badge>
    </span>
  );
}

/**
 * Värderingssektionen — delas av den fullständiga rapporten ("Är priset
 * rimligt?") och priskollen (steg 1 på `/analysera`). Tar
 * `PrisanalysUtanForening`: utan utgångspris utelämnas prisraderna och
 * rubriken ändras, i övrigt är renderingen identisk. `skuldrad` finns bara i
 * den fullständiga analysen (se andelAvSkuldRad i analysisView.ts).
 */
export function Prisrimlighet({
  prisanalys: p,
  skuldrad,
  avgiftsprognos,
  byggarJamforelse,
  boarea,
}: {
  prisanalys: PrisanalysUtanForening;
  /** The flat's boarea, for the small kr/m² line under each estimate. */
  boarea?: number | undefined;
  skuldrad?: AndelAvSkuldRad | undefined;
  /** Bara i den fullständiga analysen (och bara när servern räknat fram den). */
  avgiftsprognos?: Avgiftsprognos | undefined;
  /** Raden `falt === "byggar"` ur `uppgiftsjamforelse`; bara i den fullständiga analysen. */
  byggarJamforelse?: Faltjamforelse | undefined;
}) {
  const byggarNotis = byggarPrisNotis(byggarJamforelse);
  const u = p.varderingsunderlag;
  const tackningText = u ? varderingsTackningText(u) : null;
  const varderingslabel =
    p.externVardering?.source === "schablon" ? PRIS_LABEL_BAS : "Extern värdering";
  // The span sits under the main shown value (adjusted if it exists, else the
  // baseline) and only for Binfo's own estimate; it is ±10 % of the exact value.
  const avvikelse = prisAvvikelseRad(p);
  const visat = p.externVardering?.source === "schablon" ? visatVarde(p) : null;
  const kvmRad = (varde: number | null | undefined) => {
    const text = kvmPrisForVardering(varde, boarea);
    return text ? (
      <p className="mt-0.5 text-xs tabular-nums text-muted-foreground" data-slot="kvmpris">
        {text}
      </p>
    ) : null;
  };
  const spannRad = visat ? (
    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground" data-slot="vardespann">
      {VARDESPANN_LABEL}: {formatVardespann(visat.exakt)}
    </p>
  ) : null;
  return (
    <section className="mb-10">
      <SectionTitle
        hint={
          p.utgangspris
            ? "Jämförelse mot Binfos värderingsmodell och pris per kvadratmeter."
            : "Binfos uppskattning utifrån lägenhetens egna uppgifter."
        }
      >
        {p.utgangspris ? "Är priset rimligt?" : "Binfos värdering"}
      </SectionTitle>
      {tackningText?.typ === "utanfor_lan" ? (
        <div className="mb-4">
          <Callout variant="flag" title={tackningText.titel ?? "Utanför täckningsområdet"}>
            <p>{tackningText.text}</p>
          </Callout>
        </div>
      ) : null}
      <Card>
        <div className="divide-y divide-border">
          {p.utgangspris ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-foreground">Utgångspris</p>
              {/* ml-auto: value stays at the right edge also when the row wraps (owner 2026-10-26). */}
              <div className="ml-auto text-right">
                <p className="font-display text-xl text-foreground">
                  {formatFigureVarde(p.utgangspris)}
                </p>
                {/* Price per m² as a small line, not its own row (owner 2026-10-26). */}
                {p.prisPerM2 ? (
                  <p
                    className="mt-0.5 text-xs tabular-nums text-muted-foreground"
                    data-slot="kvmpris"
                  >
                    {formatFigureVarde(p.prisPerM2)}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {p.externVardering ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {varderingslabel}
                  {p.externVardering.source === "schablon" ? <Tag>Estimat</Tag> : null}
                </p>
                {/* Dold rad (ägarens beslut 2026-10-09): leverantören av
                    värderingen visas inte i rapporten. Uppgiften finns kvar i
                    analysdatat och kan tas fram igen genom att ta bort
                    dölj-klassen. */}
                <p className="hidden text-xs text-muted-foreground">
                  {p.externVardering.leverantor}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="font-display text-xl text-foreground">
                  {formatVardeFigurAvrundat(p.externVardering)}
                </p>
                {kvmRad(p.externVardering.value)}
                {visat?.kalla === "bas" ? spannRad : null}
                {avvikelse && p.justeradVardering === undefined ? (
                  <p className={`mt-1.5 text-xs leading-snug ${TON_TEXT[avvikelse.ton]}`}>
                    {avvikelse.text}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-foreground">Binfos värdering</p>
              <p className="text-sm text-muted-foreground">
                Inte tillgänglig — postnumret saknas eller är ogiltigt
              </p>
            </div>
          )}

          {p.justeradVardering ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                {PRIS_LABEL_JUSTERAD}
                <Tag>Estimat</Tag>
              </p>
              <div className="ml-auto text-right">
                <p className="font-display text-xl text-foreground">
                  {formatVardeFigurAvrundat(p.justeradVardering)}
                </p>
                {kvmRad(p.justeradVardering.value)}
                {visat?.kalla === "justerad" ? spannRad : null}
                {avvikelse && p.justeradVardering ? (
                  <p className={`mt-1.5 text-xs leading-snug ${TON_TEXT[avvikelse.ton]}`}>
                    {avvikelse.text}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {byggarNotis ? (
            <div
              className="flex flex-wrap items-center gap-2 py-4 first:pt-0 last:pb-0"
              data-slot="pris-byggar"
            >
              <p className="text-xs text-muted-foreground">{byggarNotis.text}</p>
              {byggarNotis.sida ? <Tag>{byggarNotis.sida}</Tag> : null}
            </div>
          ) : null}

          {skuldrad ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-4 first:pt-0 last:pb-0">
              <p className="max-w-xl text-sm text-muted-foreground">{skuldrad.text}</p>
              <div className="flex items-center gap-2">
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
              </div>
            </div>
          ) : null}
        </div>

        {u ? (
          <div className="mt-6 space-y-3 border-t border-border pt-6">
            <p className="text-sm font-medium text-foreground">
              Område:{" "}
              {u.omrade ??
                (tackningText
                  ? (u.kommun ?? u.prisniva?.region ?? "Okänt")
                  : "Stockholm (postnumret saknas i vår områdesindelning)")}
            </p>
            {tackningText?.typ === "lan" ? (
              <p className="text-xs text-muted-foreground">{tackningText.text}</p>
            ) : null}
          </div>
        ) : null}

        {p.budpremie ? (
          <p className="mt-3 text-sm text-foreground">{formatBudpremieText(p.budpremie)}</p>
        ) : null}

        <p className="mt-6 rounded-xl bg-secondary p-4 text-sm text-foreground">{p.slutsats}</p>

        {p.konfidens.niva === "lag" && p.konfidens.skal && p.konfidens.skal.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Låg tillförlitlighet: {p.konfidens.skal.join(" ")}
          </p>
        ) : null}
      </Card>

      {u || avgiftsprognos ? (
        <details className="mt-4 rounded-lg border border-border bg-secondary/40">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
            Så har vi räknat
          </summary>
          <div className="space-y-6 border-t border-border px-4 pb-4 pt-3">
            {u ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {RAKNA_UTGANGSLAGE_RUBRIK}
                </h3>
                <p className="text-sm text-muted-foreground">{RAKNA_UTGANGSLAGE_KORT}</p>
                <VisaMer>
                  <p className="text-sm text-muted-foreground">{RAKNA_UTGANGSLAGE_INTRO}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {RAKNA_FAKTORER.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {varderingsKallaText(u.dataperiod)}
                  </p>
                </VisaMer>
              </div>
            ) : null}
            {/* Exact kronor live only here, in the method layer (owner 2026-10-26). */}
            {p.justeradVardering && avgiftsprognos ? (
              <PrisVattenfall prisanalys={p} prognos={avgiftsprognos} />
            ) : null}
            {avgiftsprognos ? <RaknaPrognos prognos={avgiftsprognos} prisanalys={p} /> : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}

/** Liten färgprick för avgiftstryck (samma toner som nyckeltalens status). */
function Prick({ ton, etikett }: { ton: Ton; etikett?: string }) {
  return (
    <>
      <span
        data-ton={ton}
        className={`inline-block size-2.5 shrink-0 rounded-full ${TON_BG[ton]}`}
        aria-hidden
      />
      {etikett ? <span className="sr-only">{etikett}</span> : null}
    </>
  );
}

/** "Visa mer": inbyggd <details>, stängd från start (fungerar utan JS och i SSR). */
function VisaMer({ children, etikett = "Visa mer" }: { children: ReactNode; etikett?: string }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-medium text-primary">{etikett}</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

function KallaTagg({ text }: { text: string }) {
  return <Tag>{text}</Tag>;
}

/** Stapeldiagram från "vad jämförbara säljs för" till det justerade värdet. */
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
    <div className="rounded-lg border border-border bg-card p-4" data-slot="pris-vattenfall">
      <p className="mb-4 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Så påverkar föreningens ekonomi priset
      </p>
      <ul className="space-y-2">
        {v.rader.map((r: VattenfallRad) => (
          <li
            key={r.id}
            className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,9rem)_1fr_auto] sm:gap-3"
          >
            <span className="min-w-0 text-xs text-foreground">{r.label}</span>
            <span className="relative h-3 rounded bg-secondary" aria-hidden>
              <span
                data-ton={r.ton}
                className={`absolute inset-y-0 rounded ${r.typ === "steg" ? TON_BG[r.ton] : "bg-foreground/60"}`}
                style={{ left: `${r.vansterPct}%`, width: `${r.breddPct}%` }}
              />
            </span>
            <span
              className={`text-right text-xs font-medium ${r.typ === "steg" ? TON_TEXT[r.ton] : "text-foreground"}`}
            >
              {r.beloppText}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Skalan är utzoomad kring värdena.
        {v.proportionell ? " Delbeloppen är fördelade efter komponenternas kr/mån." : ""}
      </p>
    </div>
  );
}

/** Sparandekedjan: behov → sparar → glapp → avgift → pris, plus en stapel. */
function SparSteg({
  prognos,
  prisanalys,
}: {
  prognos: Avgiftsprognos;
  prisanalys: PrisanalysUtanForening;
}) {
  const kedja = sparKedja(prognos, prisanalys);
  const sb = prognos.sparbehov;
  if (!kedja || !sb) return null;
  const komp = sparKomponent(prognos);
  const byggdelar = byggdelRader(sb);
  return (
    <div className="space-y-3" data-slot="spar-steg">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-foreground">Sparande till underhåll</h4>
        {komp?.tryck ? (
          <Prick ton={TRYCK_TON[komp.tryck]} etikett={TRYCK_ETIKETT[komp.tryck]} />
        ) : null}
        {kedja.dampningTag ? <Tag>{kedja.dampningTag}</Tag> : null}
      </div>
      <ol className="flex flex-wrap items-stretch gap-2">
        {kedja.steg.map((k, i) => (
          <li key={k.id} className="flex items-center gap-2">
            {i > 0 ? (
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
            ) : null}
            <div className="rounded-xl border border-border bg-card px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {k.rubrik}
              </p>
              <p className={`font-display text-lg ${k.ton ? TON_TEXT[k.ton] : "text-foreground"}`}>
                {k.varde}
              </p>
              {k.kalla ? <KallaTagg text={k.kalla} /> : null}
            </div>
          </li>
        ))}
      </ol>
      <div className="space-y-1" aria-hidden>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-12">Behov</span>
          <span className="h-2 flex-1 rounded bg-secondary">
            <span
              className="block h-2 rounded bg-foreground/50"
              style={{ width: `${kedja.behovPct}%` }}
            />
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-12">Sparar</span>
          <span className="h-2 flex-1 rounded bg-secondary">
            <span
              data-ton={kedja.sparTon}
              className={`block h-2 rounded ${TON_BG[kedja.sparTon]}`}
              style={{ width: `${kedja.sparPct ?? 0}%` }}
            />
          </span>
        </div>
      </div>
      {byggdelar.length > 0 ? (
        <VisaMer etikett="Visa byggdelarna">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                <th className="pb-1 font-medium">Byggdel</th>
                <th className="pb-1 font-medium">Senast</th>
                <th className="pb-1 font-medium">Normalt</th>
                <th className="pb-1 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {byggdelar.map((b) => (
                <tr key={b.key}>
                  <td className="py-1.5 text-foreground">{b.label}</td>
                  <td className="py-1.5 text-muted-foreground">
                    {b.senast}{" "}
                    {b.ref ? (
                      <span title={b.ref.excerpt}>
                        <Tag>s. {b.ref.page}</Tag>
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-muted-foreground">{b.livslangd}</td>
                  <td className="py-1.5 text-right">
                    <Badge tone={b.ton === "neutral" ? "neutral" : b.ton}>{b.statusEtikett}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">{byggdelNot()}</p>
          <p className="text-[11px] text-muted-foreground">{BYGGDEL_KALLA_TEXT}</p>
        </VisaMer>
      ) : null}
      {/* The basis, so the kr/mån can be reproduced (owner 2026-10-26). */}
      {komp ? (
        <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
          {komp.forklaring}
        </p>
      ) : null}
    </div>
  );
}

/** Refinansieringssteget: stort tal, lånelista och försiktighetsraden. */
function RefiSteg({ prognos }: { prognos: Avgiftsprognos }) {
  const r = prognos.refinansiering;
  const komp = refiKomponent(prognos);
  if (!r && !komp) return null;
  const rader = r ? lanRader(r, prognos.horisontManader, prognos.andel?.varde) : [];
  const antagen = r ? antagenAndelText(r) : undefined;
  const vard = komp ? komponentRader({ ...prognos, komponenter: [komp] })[0] : undefined;
  return (
    <div className="space-y-3" data-slot="refi-steg">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-foreground">Lån som omsätts</h4>
          {komp?.tryck ? (
            <Prick ton={TRYCK_TON[komp.tryck]} etikett={TRYCK_ETIKETT[komp.tryck]} />
          ) : null}
        </div>
        {vard ? (
          <span
            className={`font-display text-xl ${vard.dimmad ? "text-muted-foreground" : TON_TEXT[tonForTryck(komp?.tryck)]}`}
          >
            {vard.vardeText}
          </span>
        ) : null}
      </div>
      {rader.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                <th className="pb-1 font-medium">Förfaller</th>
                <th className="pb-1 text-right font-medium">Belopp</th>
                <th className="pb-1 pr-3 text-right font-medium">Ränta</th>
                <th className="pb-1 pl-3 font-medium">Period</th>
                <th className="pb-1 text-right font-medium">Effekt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rader.map((l) => (
                <tr
                  key={l.key}
                  data-fas={l.forfallit ? "forfallit" : l.senare ? "senare" : "inom"}
                  className={l.forfallit ? "opacity-70" : undefined}
                >
                  <td
                    className={`py-1.5 align-top ${l.forfallit ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {l.forfaller}
                  </td>
                  <td
                    className={`py-1.5 text-right align-top ${l.forfallit ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {l.belopp}
                  </td>
                  {l.forfallit ? (
                    <td
                      className="py-1.5 pl-3 italic leading-snug text-muted-foreground"
                      colSpan={3}
                    >
                      – {FORFALLIT_LAN_TEXT}
                    </td>
                  ) : (
                    <>
                      <td className="py-1.5 pr-3 text-right text-muted-foreground">{l.ranta}</td>
                      <td className="py-1.5 pl-3 text-muted-foreground">{l.fas}</td>
                      <td className="py-1.5 text-right text-foreground">
                        {l.effekt}
                        {l.effektForening ? (
                          <span className="block text-[11px] text-muted-foreground">
                            {l.effektForening} (föreningen)
                          </span>
                        ) : null}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {r && rader.some((l) => l.senare) ? (
        <p className="text-xs text-muted-foreground">{REFI_FASTRAD}</p>
      ) : null}
      {r ? <p className="text-[11px] text-muted-foreground">{referensrantaRad(r)}</p> : null}
      {komp?.ref ? (
        <span title={komp.ref.excerpt}>
          <Tag>Årsredovisning s. {komp.ref.page}</Tag>
        </span>
      ) : null}
      <VisaMer etikett="Visa hela uträkningen">
        {komp ? <p className="text-xs text-muted-foreground">{komp.forklaring}</p> : null}
        {r ? (
          <ul className="space-y-1 text-xs text-foreground">
            {refinansieringRader(r).map((rad) => (
              <li key={rad.label}>
                <span className="text-muted-foreground">{rad.label}:</span> {rad.value}
              </li>
            ))}
          </ul>
        ) : null}
        {antagen ? <p className="text-xs text-muted-foreground">{antagen}</p> : null}
      </VisaMer>
    </div>
  );
}

/** Del 2: den väntade avgiftsutvecklingen, visuellt först och text sedan. */
function RaknaPrognos({
  prognos,
  prisanalys,
}: {
  prognos: Avgiftsprognos;
  prisanalys: PrisanalysUtanForening;
}) {
  const huvud = avgiftsHuvud(prognos);
  const spar = sparKomponent(prognos);
  const refi = refiKomponent(prognos);
  const harSparSteg = prognos.sparbehov !== undefined && spar !== undefined;
  const ovriga = komponentRader(prognos).filter(
    (k) => !(harSparSteg && k.id === spar?.id) && k.id !== refi?.id,
  );
  const prisTexter = prisEffektTexter(prisanalys);
  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {RAKNA_PROGNOS_RUBRIK}
            {prognos.tryck ? (
              <Prick ton={TRYCK_TON[prognos.tryck]} etikett={TRYCK_ETIKETT[prognos.tryck]} />
            ) : null}
          </h3>
          <div className="text-right">
            <p
              data-ton={tonForTryck(prognos.tryck)}
              className={`font-display text-2xl ${TON_TEXT[tonForTryck(prognos.tryck)]}`}
            >
              {huvud.varde}
            </p>
            <p className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
              {huvud.under} <Tag>Uppskattning</Tag>
            </p>
          </div>
        </div>
        {prognos.tryck ? (
          <p className="text-xs text-muted-foreground">{TRYCK_ETIKETT[prognos.tryck]}</p>
        ) : null}
        {prognos.osaker ? <p className="text-xs text-muted-foreground">{prognos.osaker}</p> : null}

        {harSparSteg ? <SparSteg prognos={prognos} prisanalys={prisanalys} /> : null}
        <RefiSteg prognos={prognos} />

        {ovriga.length > 0 ? (
          <ul className="divide-y divide-border">
            {ovriga.map((k) => {
              const komp = prognos.komponenter.find((x) => x.id === k.id);
              const kalla = komp ? komponentKalla(komp) : undefined;
              return (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {komp?.tryck ? (
                      <Prick ton={TRYCK_TON[komp.tryck]} etikett={TRYCK_ETIKETT[komp.tryck]} />
                    ) : null}
                    {k.label}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`text-sm ${k.dimmad ? "text-muted-foreground" : "text-foreground"}`}
                    >
                      {k.vardeText}
                    </span>
                    {kalla ? (
                      <span title={komp?.ref?.excerpt}>
                        <KallaTagg text={kalla.text} />
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {ovriga.length > 0 ? (
          <VisaMer etikett="Visa mer om övriga delar">
            <ul className="space-y-1 text-xs text-muted-foreground">
              {ovriga.map((k) => (
                <li key={k.id}>
                  <span className="font-medium text-foreground">{k.label}:</span> {k.forklaring}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{ENERGI_TEXT}</p>
          </VisaMer>
        ) : null}
        {prisTexter.length > 0 ? (
          <VisaMer etikett="Så räknas avgiften om till pris">
            {prisTexter.map((t) => (
              <p key={t} className="text-xs text-foreground">
                {t}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">{PRISEFFEKT_CAVEAT}</p>
          </VisaMer>
        ) : null}
        <p className="text-xs text-muted-foreground">{RANTEKANSLIGHET_RAD}</p>
      </div>
    </>
  );
}
