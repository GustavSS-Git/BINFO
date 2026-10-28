import { regelGrupper, regelTyp, reglerMeta, varde } from "@/components/kalkyl/regelTyper";
import { DataTable, Details, Tag } from "@/components/ui/binfo";
import { hittaRegel, type Regel } from "@/lib/kalkyl/regler";

export function ReglerTabell() {
  const grupper = regelGrupper();
  const alla = grupper.flatMap((g) => g.regler);
  const utanKontroll = alla.filter((r) => r.verifierad === null).length;
  const kv = hittaRegel("kalp_mat")?.kalla;

  return (
    <Details summary="Regler och antaganden" meta={reglerMeta(alla)}>
      <div data-slot="kalkyl-regler" className="space-y-4">
        <p className="m-0">
          Det här är reglerna och siffrorna som kalkylen räknar med, och var de kommer ifrån.
        </p>
        <ul className="m-0 list-none space-y-1 p-0 text-[15px]">
          <li>
            <strong className="text-foreground">Regel</strong> = lag eller myndighetsbeslut.
          </li>
          <li>
            <strong className="text-foreground">Referensvärde</strong> = publicerat värde från en
            offentlig källa, men inte en regel.
          </li>
          <li>
            <strong className="text-foreground">Antagande</strong> = Binfos val, utan regel bakom.
          </li>
          <li>
            <strong className="text-foreground">Uppskattning</strong> = Binfos schablon, ersätts när
            en offentlig källa finns.
          </li>
        </ul>
        {utanKontroll > 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            {utanKontroll} av posterna saknar publicerad källa och är inte kontrollerade mot någon.
          </p>
        ) : null}
        {grupper.map((g) => (
          <Details key={g.grupp} summary={g.grupp} meta={`${g.regler.length} st`}>
            <DataTable minWidth={680}>
              <thead>
                <tr>
                  <th scope="col">Vad</th>
                  <th scope="col">Värde</th>
                  <th scope="col">Källa</th>
                  <th scope="col">Typ</th>
                </tr>
              </thead>
              <tbody>
                {g.regler.map((r) => {
                  const typ = regelTyp(r.status);
                  return (
                    <tr key={r.id} className="align-top">
                      <th scope="row">
                        {r.namn}
                        {r.anmarkning ? (
                          <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">
                            {r.anmarkning}
                          </span>
                        ) : null}
                      </th>
                      <td className="text-[15px]">{varde(r)}</td>
                      <td className="text-[15px]">
                        {r.kalla.url !== null ? (
                          <a className="text-link underline underline-offset-2" href={r.kalla.url}>
                            {r.kalla.titel}
                          </a>
                        ) : (
                          r.kalla.titel
                        )}
                        {r.referens ? ` ${r.referens}` : ""}
                      </td>
                      <td>
                        <Tag tone={typ.ton}>{typ.etikett}</Tag>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </Details>
        ))}
        {kv?.url ? (
          <p className="m-0 text-sm text-muted-foreground">
            Konsumentverkets alla tabellvärden finns i{" "}
            <a className="text-link underline underline-offset-2" href={kv.url}>
              Hushållskostnader 2026
            </a>
            .
          </p>
        ) : null}
      </div>
    </Details>
  );
}
