import { useState } from "react";
import { Card, Tag } from "@/components/ui/binfo";
import { DENNA_LAGENHET_TEXT, byggForsaljningarVy } from "@/lib/annons/forsaljningarVy";
import type { ForsaljningarSvar } from "@/lib/annons/forsaljningar";

/**
 * "Sålda lägenheter på <adress>": en enkel tabell under värderingen, de fem senaste och
 * "Visa alla (n)". Visas bara, ingår aldrig i värderingen. På smal skärm blir varje
 * försäljning två rader.
 */
export function TidigareForsaljningar({ svar }: { svar: ForsaljningarSvar | null }) {
  const vy = byggForsaljningarVy(svar);
  const [allaVisas, setAllaVisas] = useState(false);
  if (!vy) return null;
  const rader = allaVisas ? vy.rader : vy.rader.slice(0, vy.visas);
  return (
    <div data-slot="tidigare-forsaljningar">
      <Card className="flex flex-col gap-3">
        <h3 className="text-[19px] font-semibold text-foreground">{vy.rubrik}</h3>
        <table className="w-full border-collapse text-base text-foreground">
          <thead className="hidden text-[13px] text-muted-foreground sm:table-header-group">
            <tr>
              <th className="py-2 pr-3 text-left font-semibold">Såld</th>
              <th className="py-2 pr-3 text-left font-semibold">Pris</th>
              <th className="py-2 pr-3 text-left font-semibold">kr/m²</th>
              <th className="py-2 pr-3 text-left font-semibold">Storlek</th>
              <th className="py-2 pr-3 text-left font-semibold">Våning</th>
              <th className="py-2 text-left font-semibold">Avgift</th>
            </tr>
          </thead>
          <tbody>
            {rader.map((r, i) => (
              <tr
                key={i}
                className="grid grid-cols-12 gap-x-3 border-t border-divider py-3 sm:table-row"
              >
                <td className="col-span-6 font-medium sm:table-cell sm:py-3 sm:pr-3">
                  {" "}
                  {r.sald}
                  {r.dennaLagenhet ? (
                    <span className="ml-2 inline-block align-middle">
                      <Tag>{DENNA_LAGENHET_TEXT}</Tag>
                    </span>
                  ) : null}
                </td>
                <td className="col-span-6 text-right sm:table-cell sm:py-3 sm:pr-3 sm:text-left">
                  {r.pris}
                </td>
                <td className="col-span-3 text-sm text-text-2 sm:table-cell sm:py-3 sm:pr-3 sm:text-base">
                  {r.krPerM2}
                  <span className="sm:hidden"> kr/m²</span>
                </td>
                <td className="col-span-4 text-sm text-text-2 sm:table-cell sm:py-3 sm:pr-3 sm:text-base">
                  {r.storlek}
                </td>
                <td className="col-span-2 text-sm text-text-2 sm:table-cell sm:py-3 sm:pr-3 sm:text-base">
                  <span className="sm:hidden">vån </span>
                  {r.vaning}
                </td>
                <td className="col-span-3 text-right text-sm text-text-2 sm:table-cell sm:py-3 sm:text-left sm:text-base">
                  {r.avgift}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {vy.visaAllaText ? (
          <button
            type="button"
            onClick={() => setAllaVisas((v) => !v)}
            aria-expanded={allaVisas}
            className="self-start text-base font-medium text-link underline underline-offset-2"
          >
            {allaVisas ? "Visa färre" : vy.visaAllaText}
          </button>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {vy.fotnot}{" "}
          <a
            href={vy.attributionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link underline underline-offset-2"
          >
            {vy.attributionText}
          </a>
          .
        </p>
      </Card>
    </div>
  );
}
