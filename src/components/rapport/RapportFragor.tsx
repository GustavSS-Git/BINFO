import { useId, useState } from "react";
import { Card, SektionsRubrik } from "@/components/ui/binfo";
import { antalIOrd, medVersal, svarssignalDelar } from "@/lib/analysisView";
import type { AnalysisResult, Fraga } from "@/types/analysis";

/** Svarssignalen under en fråga: två rader när både "Bra svar" och "Varningssignal" finns. */
function Svarssignal({ signal }: { signal: string }) {
  const delar = svarssignalDelar(signal);
  if (delar.typ === "tva") {
    return (
      <>
        <p className="text-[15px] text-text-2">
          <span className="font-semibold text-text-2">Bra svar: </span>
          {delar.bra}
        </p>
        <p className="text-[15px] text-text-2">
          <span className="font-semibold text-text-2">Varningssignal: </span>
          {delar.varning}
        </p>
      </>
    );
  }
  return <p className="text-[15px] text-text-2">{delar.text}</p>;
}

/**
 * Avsnitt 4, "Inför visningen": frågor att ställa, med checkbox, "Varför" och svarssignal.
 * Visar bara frågor härledda ur analysen (`ursprung === "analys"`). Delas av rapporten och
 * den sparade BRF-analysen i registret (`medPrognos={false}`: ingen avgiftsprognos där).
 */
export function Fragor({
  analys,
  medPrognos = true,
}: {
  analys: Pick<AnalysisResult, "fragor">;
  medPrognos?: boolean;
}) {
  const prefix = useId();
  const [checked, setChecked] = useState<string[]>([]);
  const toggle = (k: string) =>
    setChecked((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  const fragor = analys.fragor.filter((f) => f.ursprung === "analys");
  if (fragor.length === 0) return null;

  const rad = (f: Fraga) => {
    const id = `${prefix}-${f.id}`;
    const klar = checked.includes(f.id);
    return (
      <li key={f.id} className="flex items-start gap-4 py-5 first:pt-0 last:pb-0">
        <input
          id={id}
          type="checkbox"
          checked={klar}
          onChange={() => toggle(f.id)}
          className="mt-1 size-5 shrink-0 accent-primary"
        />
        <div className="flex min-w-0 flex-col gap-2">
          <label
            htmlFor={id}
            className={`cursor-pointer text-[17px] font-semibold leading-snug ${
              klar ? "text-muted-foreground line-through" : "text-foreground"
            }`}
          >
            {f.fraga}
          </label>
          <div className="flex flex-col gap-1">
            <p className="text-[15px] text-text-2">
              <span className="font-semibold text-text-2">Varför: </span>
              {f.varfor}
            </p>
            {f.svarssignal ? <Svarssignal signal={f.svarssignal} /> : null}
          </div>
        </div>
      </li>
    );
  };

  return (
    <section className="flex flex-col gap-7">
      <SektionsRubrik
        id="fragor"
        nummer="4"
        eyebrow="Inför visningen"
        titel={`${medVersal(antalIOrd(fragor.length))} ${fragor.length === 1 ? "fråga" : "frågor"} till mäklaren och styrelsen`}
        lead={`Svaren avgör om betyget${medPrognos ? " och avgiftsprognosen" : ""} håller. Bocka av frågorna när du har fått svar.`}
      />
      <Card>
        <ul className="m-0 flex list-none flex-col divide-y divide-divider p-0">
          {fragor.map((f) => rad(f))}
        </ul>
      </Card>
    </section>
  );
}
