import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button, Card, DataTable, Field, GradeBadge, LinkButton } from "@/components/ui/binfo";
import { formatSkapadDatum, formatVarde } from "@/lib/analysisView";
import {
  SORT_ALTERNATIV,
  antalForeningar,
  sorteringsEtikett,
  sorteringsVarde,
  standardRiktning,
  tolkaSorteringsVarde,
  type RegisterListaSvar,
  type RegisterListrad,
  type RegisterRiktning,
  type RegisterSortering,
} from "@/lib/registerVy";

/**
 * Delar av de publika register-sidorna som delas mellan `/brf` (sökresultat)
 * och `/brf/omrade/$omrade` (tabell). Betyg visas med `GradeBadge` i betygets
 * färg (ägarbeslut 2026-10-28; tidigare var märket neutralt).
 */

function kronorPerM2(v: number | null): string {
  return v === null ? "–" : formatVarde(v, "kr/m2");
}

/** Sökfält (namn eller organisationsnummer). Skickar bara när användaren söker. */
export function SokFalt({
  startvarde,
  onSok,
  etikett = "Sök förening",
  placeholder = "Namn eller organisationsnummer",
}: {
  startvarde: string;
  onSok: (sok: string) => void;
  etikett?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(startvarde);
  return (
    <form
      role="search"
      className="flex flex-wrap items-end gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSok(text.trim());
      }}
    >
      <div className="min-w-60 flex-[1_1_320px]">
        <Field
          label={etikett}
          type="search"
          value={text}
          onChange={setText}
          placeholder={placeholder}
        />
      </div>
      <Button type="submit" size="lg">
        Sök
      </Button>
      {startvarde !== "" ? (
        <Button
          type="button"
          variant="ghost"
          size="lg"
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

/** "Sortera efter": en lista som sätter samma URL-läge som kolumnrubrikerna. */
export function SorteraVal({
  sortering,
  riktning,
  onAndra,
}: {
  sortering: RegisterSortering;
  riktning: RegisterRiktning;
  onAndra: (andring: TabellAndring) => void;
}) {
  const nu = sorteringsVarde(sortering, riktning);
  const fasta = SORT_ALTERNATIV.map((a) => ({
    varde: sorteringsVarde(a.sortering, a.riktning),
    etikett: a.etikett,
  }));
  // A state reached only through a column header gets its own (last) option.
  const alternativ = fasta.some((a) => a.varde === nu)
    ? fasta
    : [...fasta, { varde: nu, etikett: sorteringsEtikett(sortering, riktning) }];
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="register-sortering" className="text-sm font-semibold text-foreground">
        Sortera efter
      </label>
      <select
        id="register-sortering"
        value={nu}
        onChange={(e) => {
          const val = tolkaSorteringsVarde(e.target.value);
          if (val) onAndra({ ...val, sida: 1 });
        }}
        className="h-12 w-full rounded-sm border border-input bg-card px-3.5 text-base text-foreground"
      >
        {alternativ.map((a) => (
          <option key={a.varde} value={a.varde}>
            {a.etikett}
          </option>
        ))}
      </select>
    </div>
  );
}

interface Kolumn {
  id: RegisterSortering;
  rubrik: string;
  varde: (r: RegisterListrad) => string;
}

const MATKOLUMNER: Kolumn[] = [
  {
    id: "skuld_brf",
    rubrik: "Skuld per m² bostadsrättsyta",
    varde: (r) => kronorPerM2(r.skuldPerM2Brf),
  },
  { id: "avgift", rubrik: "Årsavgift per m²", varde: (r) => kronorPerM2(r.avgiftPerM2) },
  { id: "sparande", rubrik: "Sparande per m²", varde: (r) => kronorPerM2(r.sparandePerM2) },
];

export interface TabellAndring {
  sortering?: RegisterSortering;
  riktning?: RegisterRiktning;
  sida?: number;
}

/**
 * Föreningar som tabell (från `md`) eller kort (mobil, 390 px: sju kolumner
 * hade krävt sidledsrullning), med sorterbara rubriker (`<button>` +
 * `aria-sort`) och sidnavigering. Själva navigeringen (URL:en) äger routen —
 * komponenten rapporterar bara önskad ändring.
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
      className="rounded-sm text-left font-semibold underline-offset-4 hover:underline"
    >
      {text}
      {pil(id)}
    </button>
  );

  return (
    <div>
      <ul className="m-0 list-none space-y-3 p-0 md:hidden">
        {rader.map((r) => (
          <li key={r.orgnr}>
            <Link to="/brf/$slug" params={{ slug: r.slug }} className="block">
              <Card className="p-5 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-primary">{r.namn}</h3>
                  <GradeBadge grade={r.betyg} size="sm" />
                </div>
                {visaOmrade ? (
                  <p className="mt-1 text-sm text-muted-foreground">{r.omradeNamn}</p>
                ) : null}
                <dl className="mt-4 grid grid-cols-1 gap-y-2 text-sm">
                  {MATKOLUMNER.map((k) => (
                    <div key={k.id} className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">{k.rubrik}</dt>
                      <dd className="font-medium text-foreground">{k.varde(r)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-sm text-muted-foreground">
                  Räkenskapsår {r.rakenskapsar} · analyserad {formatSkapadDatum(r.analysdatum)}
                </p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden md:block">
        <DataTable minWidth={860}>
          <thead>
            <tr>
              <th scope="col">Förening</th>
              {visaOmrade ? <th scope="col">Område</th> : null}
              <th scope="col" aria-sort={ariaSort("betyg")}>
                {sortKnapp("betyg", "Betyg")}
              </th>
              {MATKOLUMNER.map((k) => (
                <th key={k.id} scope="col" aria-sort={ariaSort(k.id)}>
                  {sortKnapp(k.id, k.rubrik)}
                </th>
              ))}
              <th scope="col">Räkenskapsår</th>
              <th scope="col" aria-sort={ariaSort("analysdatum")}>
                {sortKnapp("analysdatum", "Analyserad")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rader.map((r) => (
              <tr key={r.orgnr}>
                <th scope="row">
                  <Link
                    to="/brf/$slug"
                    params={{ slug: r.slug }}
                    className="font-semibold text-link underline-offset-2 hover:underline"
                  >
                    {r.namn}
                  </Link>
                </th>
                {visaOmrade ? <td>{r.omradeNamn}</td> : null}
                <td>
                  <GradeBadge grade={r.betyg} size="sm" />
                </td>
                {MATKOLUMNER.map((k) => (
                  <td key={k.id}>{k.varde(r)}</td>
                ))}
                <td>{r.rakenskapsar}</td>
                <td className="text-muted-foreground">{formatSkapadDatum(r.analysdatum)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
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
            Sida {sida} av {antalSidor} · {antalForeningar(totalt)}
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
        <p className="mt-4 text-sm text-muted-foreground">{antalForeningar(totalt)}</p>
      )}
    </div>
  );
}

/** Tomt läge: ingen förening i området än (eller inga sökträffar). */
export function TomtLage({ sok }: { sok: string }) {
  return (
    <Card>
      {sok !== "" ? (
        <p className="text-base text-foreground">
          Inga föreningar matchar &quot;{sok}&quot;. Prova ett kortare namn eller bara
          organisationsnumret.
        </p>
      ) : (
        <>
          <p className="text-base text-foreground">
            Inga föreningar här ännu — ladda upp en årsredovisning så hamnar föreningen här.
          </p>
          <div className="mt-5">
            <LinkButton to="/analysera" size="lg">
              Analysera en bostad
            </LinkButton>
          </div>
        </>
      )}
    </Card>
  );
}
