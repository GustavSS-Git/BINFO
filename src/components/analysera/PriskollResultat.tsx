import type { ReactNode } from "react";
import { Callout, DataTable, Details, Eyebrow, SpanBar } from "@/components/ui/binfo";
import { RAKNA_FAKTORER, varderingsKallaText, varderingsTackningText } from "@/lib/analysisView";
import { TidigareForsaljningar } from "@/components/rapport/TidigareForsaljningar";
import { useTidigareForsaljningar } from "@/components/rapport/useTidigareForsaljningar";
import { byggPriskollVy } from "@/lib/priskollVy";
import type { PrisuppskattningResultat } from "@/types/analysis";

export const NOTIS_TITEL = "Föreningens ekonomi är inte inräknad, förutom avgiften.";
const NOTIS_BAS =
  "Lågt sparande, stora underhållsbehov eller hög skuld brukar betyda att avgiften kommer att höjas, och det kan sänka värdet rejält.";
export const NOTIS_MED_STEG2 = `${NOTIS_BAS} Lägg till årsredovisningen i steg 2 så räknar vi in det.`;
export const NOTIS_UTAN_STEG2 = `${NOTIS_BAS} Analysera bostaden tillsammans med årsredovisningen så räknar vi in det.`;

/** "Boarea: större yta …" -> fetstil på etiketten före första kolon. */
function Faktor({ text }: { text: string }) {
  const i = text.indexOf(": ");
  if (i === -1) return <li>{text}</li>;
  return (
    <li>
      <strong className="font-semibold text-foreground">{text.slice(0, i + 1)}</strong>{" "}
      {text.slice(i + 2)}
    </li>
  );
}

/**
 * Resultatet av Priskollen (och en sparad värdering): Binfos modell UTAN hänsyn till
 * föreningen. Samma block på /analysera och på en sparad värdering; allt som visas kommer
 * ur `resultat.prisanalys` via `byggPriskollVy`. Spara-kortet och uppmaningen till steg 2
 * ligger utanför, hos anroparen.
 */
export function PriskollResultat({
  resultat,
  id = "varde",
  eyebrow = "Värdering utan hänsyn till föreningen",
  harSteg2 = true,
  barn,
  forsaljningarUrl,
}: {
  /** Den inklistrade Booli-länken, när formuläret fyllts från Booli (för "Tidigare försäljningar"). */
  forsaljningarUrl?: string;
  resultat: PrisuppskattningResultat;
  id?: string;
  eyebrow?: string;
  /** Sidan har ett steg 2 att hänvisa till (Priskollen) eller inte (sparad värdering). */
  harSteg2?: boolean;
  barn?: ReactNode;
}) {
  const forsaljningar = useTidigareForsaljningar(forsaljningarUrl);
  const p = resultat.prisanalys;
  const vy = byggPriskollVy(p, resultat.input.boarea);
  const u = p.varderingsunderlag;
  const tackning = u ? varderingsTackningText(u) : null;
  const lagSkal = p.konfidens.niva === "lag" && p.konfidens.skal ? p.konfidens.skal : [];

  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-6" aria-labelledby={`${id}-rubrik`}>
      {tackning?.typ === "utanfor_lan" ? (
        <Callout variant="flag" title={tackning.titel ?? "Utanför täckningsområdet"}>
          <p>{tackning.text}</p>
        </Callout>
      ) : null}

      <div className="flex max-w-[820px] flex-col gap-2">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2
          id={`${id}-rubrik`}
          className="font-display text-[26px] font-semibold leading-[1.2] text-primary md:text-[32px]"
        >
          {vy.rubrik}
        </h2>
        {vy.stycke ? <p className="text-[17px] text-text-2">{vy.stycke}</p> : null}
      </div>

      {vy.spann ? (
        <SpanBar
          lag={vy.spann.lag}
          hog={vy.spann.hog}
          markorer={vy.spann.markorer}
          ariaLabel={vy.spann.ariaLabel}
        />
      ) : (
        <p className="text-base text-muted-foreground">
          Inte tillgänglig — postnumret saknas eller är ogiltigt
        </p>
      )}

      {vy.rader.length > 0 ? (
        <DataTable minWidth={520} caption="Värdering i siffror">
          <tbody>
            {vy.rader.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="whitespace-nowrap font-semibold">{r.varde}</td>
                <td className="text-sm text-muted-foreground">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}

      {lagSkal.length > 0 ? (
        <p className="text-sm text-muted-foreground">Låg tillförlitlighet: {lagSkal.join(" ")}</p>
      ) : null}

      <Callout variant="notice" title={NOTIS_TITEL}>
        <p>{harSteg2 ? NOTIS_MED_STEG2 : NOTIS_UTAN_STEG2}</p>
      </Callout>

      <Details summary="Vad värderingen bygger på">
        <div className="flex flex-col gap-3">
          <p>
            Värderingen kommer från Binfos värderingsmodell, som bygger på tidigare försäljningar av
            bostadsrätter. Så här påverkar uppgifterna du fyllt i priset, i stora drag. Det är
            samband i försäljningsdata, inte orsaker.
          </p>
          <ul className="m-0 list-disc space-y-1 pl-5">
            {RAKNA_FAKTORER.map((f) => (
              <Faktor key={f} text={f} />
            ))}
          </ul>
          <p>
            Det är ett statistiskt värde, inte en besiktning. Modellen ser inte skick, planlösning
            eller utsikt. Dessa är faktorer som gör att priset rör sig upp och ner i det rimliga
            prisintervallet.
          </p>
          {u ? (
            <>
              <p className="font-medium text-foreground">
                Område:{" "}
                {u.omrade ??
                  (tackning
                    ? (u.kommun ?? u.prisniva?.region ?? "Okänt")
                    : "Stockholm (postnumret saknas i vår områdesindelning)")}
              </p>
              {tackning?.typ === "lan" ? <p>{tackning.text}</p> : null}
              <p className="text-sm text-muted-foreground">{varderingsKallaText(u.dataperiod)}</p>
            </>
          ) : null}
        </div>
      </Details>
      <TidigareForsaljningar svar={forsaljningar} />
      {barn}
    </section>
  );
}
