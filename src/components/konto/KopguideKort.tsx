import { LinkButton, ProgressBar } from "@/components/ui/binfo";
import { antalKlara, framstegText, synligaSteg } from "@/lib/kopguide/framsteg";
import { useKopguide } from "@/lib/kopguide/useKopguide";

/** "Köpguiden" på Mitt konto: hur långt man har kommit (konto eller denna webbläsare). */
export function KopguideKortVy({ klara, laddar }: { klara: readonly string[]; laddar: boolean }) {
  const totalt = synligaSteg("brf").length;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 sm:p-7">
      <h2 className="text-[19px] font-semibold leading-snug text-foreground">Köpguiden</h2>
      {laddar ? (
        <p className="text-[15px] text-text-2">Hämtar hur långt du har kommit…</p>
      ) : (
        <>
          <p className="text-[15px] text-text-2">{framstegText(klara, "brf")}</p>
          <ProgressBar
            andel={totalt === 0 ? 0 : antalKlara(klara, "brf") / totalt}
            label="Steg klara i köpguiden"
          />
        </>
      )}
      <div className="mt-1">
        <LinkButton to="/kopguide" variant="secondary">
          Fortsätt i köpguiden
        </LinkButton>
      </div>
    </section>
  );
}

export function KopguideKort() {
  const { klara, laddar } = useKopguide();
  return <KopguideKortVy klara={klara} laddar={laddar} />;
}
