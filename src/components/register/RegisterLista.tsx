import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Badge, Button, Card, Field, LinkButton } from "@/components/ui/binfo";
import { formatSkapadDatum, formatVarde } from "@/lib/analysisView";
import {
  standardRiktning,
  type RegisterListaSvar,
  type RegisterListrad,
  type RegisterRiktning,
  type RegisterSortering,
} from "@/lib/registerVy";

/**
 * Delar av de publika register-sidorna som delas mellan `/brf` (sökresultat)
 * och `/brf/omrade/$omrade` (tabell). Byggt av befintliga komponenter ur
 * `@/components/ui/binfo` — ingen egen stil utöver enkla tabell-/layoutklasser
 * med projektets tokens.
 */

/** Betyget som bokstav. Ingen färgtolkning av A–E: gränsen mellan "bra" och
 *  "dålig" är en produktfråga, så märket är neutralt. */
export function Betygsmarke({ betyg }: { betyg: string | null }) {
  if (betyg === null) return <span className="text-muted-foreground">–</span>;
  return (
    <span title={`Betyg ${betyg}`}>
      <Badge>Betyg {betyg}</Badge>
    </span>
  );
}

function kronorPerM2(v: number | null): string {
  return v === null ? "–" : formatVarde(v, "kr/m2");
}

/** Sökfält (namn eller organisationsnummer). Skickar bara när användaren söker. */
export function SokFalt({
  startvarde,
  onSok,
  etikett = "Sök förening",
}: {
  startvarde: string;
  onSok: (sok: string) => void;
  etikett?: string;
}) {
  const [text, setText] = useState(startvarde);
  return (
    <form
      role="search"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSok(text.trim());
      }}
    >
      <div className="min-w-60 flex-1">
        <Field
          label={etikett}
          type="search"
          value={text}
          onChange={setText}
          placeholder="Namn eller organisationsnummer"
        />
      </div>
      <Button type="submit">Sök</Button>
      {startvarde !== "" ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setText("");
            onSok("");
          }}
        >
          Rensa
        </Button>
      ) : null}
    </form>
  );
}

interface Kolumn {
  id: RegisterSortering;
  rubrik: string;
  varde: (r: RegisterListrad) => string;
}

const KOLUMNER: Kolumn[] = [
  { id: "betyg", rubrik: "Betyg", varde: (r) => r.betyg ?? "–" },
  {
    id: "skuld_brf",
    rubrik: "Skuld per m² bostadsrättsyta",
    varde: (r) => kronorPerM2(r.skuldPerM2Brf),
  },
  { id: "avgift", rubrik: "Årsavgift per m²", varde: (r) => kronorPerM2(r.avgiftPerM2) },
  { id: "sparande", rubrik: "Sparande per m²", varde: (r) => kronorPerM2(r.sparandePerM2) },
];

const SORT_ETIKETT: Record<RegisterSortering, string> = {
  betyg: "Betyg",
  skuld_brf: "Skuld per m² bostadsrättsyta",
  avgift: "Årsavgift per m²",
  sparande: "Sparande per m²",
  analysdatum: "Analysdatum",
};

export interface TabellAndring {
  sortering?: RegisterSortering;
  riktning?: RegisterRiktning;
  sida?: number;
}

/**
 * Föreningar som tabell (från `md`) eller kort (mobil), med sorterbara
 * rubriker (`<button>` + `aria-sort`) och sidnavigering. Själva navigeringen
 * (URL:en) äger routen — komponenten rapporterar bara önskad ändring.
 */
export function ForeningsTabell({
  svar,
  visaOmrade,
  onAndra,
}: {
  svar: RegisterListaSvar;
  visaOmrade: boolean;
  onAndra: (andring: TabellAndring) => void;
}) {
  const { rader, sortering, riktning, sida, sidstorlek, totalt } = svar;
  const antalSidor = Math.max(1, Math.ceil(totalt / sidstorlek));

  const sorteraPa = (id: RegisterSortering) => {
    onAndra({
      sortering: id,
      riktning: id === sortering ? (riktning === "asc" ? "desc" : "asc") : standardRiktning(id),
      sida: 1,
    });
  };
  const ariaSort = (id: RegisterSortering): "ascending" | "descending" | "none" =>
    id !== sortering ? "none" : riktning === "asc" ? "ascending" : "descending";
  const pil = (id: RegisterSortering) => (id !== sortering ? "" : riktning === "asc" ? " ↑" : " ↓");

  const sortKnapp = (id: RegisterSortering, text: string) => (
    <button
      type="button"
      onClick={() => sorteraPa(id)}
      className="rounded-sm text-left font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {text}
      {pil(id)}
    </button>
  );

  return (
    <div>
      {/* Mobil: sortering via lista, raderna blir kort. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 md:hidden">
        <label className="text-sm font-medium text-foreground" htmlFor="register-sortering">
          Sortera efter
        </label>
        <select
          id="register-sortering"
          value={sortering}
          onChange={(e) => sorteraPa(e.target.value as RegisterSortering)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
        >
          {(Object.keys(SORT_ETIKETT) as RegisterSortering[]).map((id) => (
            <option key={id} value={id}>
              {SORT_ETIKETT[id]}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onAndra({ riktning: riktning === "asc" ? "desc" : "asc", sida: 1 })}
          aria-label={riktning === "asc" ? "Stigande ordning" : "Fallande ordning"}
        >
          {riktning === "asc" ? "Stigande ↑" : "Fallande ↓"}
        </Button>
      </div>

      <ul className="space-y-3 md:hidden">
        {rader.map((r) => (
          <li key={r.orgnr}>
            <Link to="/brf/$slug" params={{ slug: r.slug }} className="block">
              <Card className="p-5 md:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-base font-semibold text-foreground">{r.namn}</h3>
                  <Betygsmarke betyg={r.betyg} />
                </div>
                {visaOmrade ? (
                  <p className="mt-1 text-xs text-muted-foreground">{r.omradeNamn}</p>
                ) : null}
                <dl className="mt-4 grid grid-cols-1 gap-y-2 text-sm">
                  {KOLUMNER.filter((k) => k.id !== "betyg").map((k) => (
                    <div key={k.id} className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">{k.rubrik}</dt>
                      <dd className="font-medium text-foreground">{k.varde(r)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  Räkenskapsår {r.rakenskapsar} · analyserad {formatSkapadDatum(r.analysdatum)}
                </p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-semibold">
                Förening
              </th>
              {visaOmrade ? (
                <th scope="col" className="px-4 py-3 font-semibold">
                  Område
                </th>
              ) : null}
              {KOLUMNER.map((k) => (
                <th key={k.id} scope="col" aria-sort={ariaSort(k.id)} className="px-4 py-3">
                  {sortKnapp(k.id, k.rubrik)}
                </th>
              ))}
              <th scope="col" className="px-4 py-3 font-semibold">
                År
              </th>
              <th scope="col" aria-sort={ariaSort("analysdatum")} className="px-4 py-3">
                {sortKnapp("analysdatum", "Analyserad")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rader.map((r) => (
              <tr key={r.orgnr} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-3 text-left font-medium text-foreground">
                  <Link
                    to="/brf/$slug"
                    params={{ slug: r.slug }}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {r.namn}
                  </Link>
                </th>
                {visaOmrade ? <td className="px-4 py-3">{r.omradeNamn}</td> : null}
                {KOLUMNER.map((k) => (
                  <td key={k.id} className="px-4 py-3 text-foreground">
                    {k.id === "betyg" ? <Betygsmarke betyg={r.betyg} /> : k.varde(r)}
                  </td>
                ))}
                <td className="px-4 py-3 text-muted-foreground">{r.rakenskapsar}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatSkapadDatum(r.analysdatum)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalt > sidstorlek ? (
        <nav
          aria-label="Sidor"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm"
        >
          <Button
            type="button"
            variant="secondary"
            disabled={sida <= 1}
            onClick={() => onAndra({ sida: sida - 1 })}
          >
            Föregående
          </Button>
          <p className="text-muted-foreground">
            Sida {sida} av {antalSidor} · {totalt} föreningar
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={sida >= antalSidor}
            onClick={() => onAndra({ sida: sida + 1 })}
          >
            Nästa
          </Button>
        </nav>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          {totalt} {totalt === 1 ? "förening" : "föreningar"}
        </p>
      )}
    </div>
  );
}

/** Tomt läge: ingen förening i området än (eller inga sökträffar). */
export function TomtLage({ sok }: { sok: string }) {
  return (
    <Card>
      {sok !== "" ? (
        <p className="text-sm text-foreground">
          Inga föreningar matchar &quot;{sok}&quot;. Prova ett kortare namn eller bara
          organisationsnumret.
        </p>
      ) : (
        <>
          <p className="text-sm text-foreground">
            Inga föreningar här ännu — ladda upp en årsredovisning så hamnar föreningen här.
          </p>
          <div className="mt-5">
            <LinkButton to="/analysera">Analysera en bostad</LinkButton>
          </div>
        </>
      )}
    </Card>
  );
}
