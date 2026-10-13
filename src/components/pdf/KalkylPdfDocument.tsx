import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { FONT_SANS, FONT_SERIF } from "@/components/pdf/fonts";
import type {
  KalkylPdfRad,
  KalkylPdfTabell,
  KalkylPdfViewModel,
} from "@/components/pdf/kalkylViewModel";
import { PDF_COLORS, PDF_DISCLAIMER, PDF_PAGE_PADDING } from "@/components/pdf/theme";

// Registrera typsnitten i anroparen (se download.tsx / downloadKalkyl.tsx),
// aldrig här: react-pdf lägger till källor i stället för att ersätta dem.

const styles = StyleSheet.create({
  page: {
    paddingTop: PDF_PAGE_PADDING + 20,
    paddingBottom: PDF_PAGE_PADDING + 24,
    paddingHorizontal: PDF_PAGE_PADDING,
    fontFamily: FONT_SANS,
    fontSize: 9,
    color: PDF_COLORS.foreground,
    backgroundColor: PDF_COLORS.background,
    // Utan detta byts "fi"/"fl" mot ligaturer som textutdrag tappar (se AnalysPdfDocument).
    fontFeatureSettings: { liga: false },
  },
  headerFixed: {
    position: "absolute",
    top: 16,
    left: PDF_PAGE_PADDING,
    right: PDF_PAGE_PADDING,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.border,
    paddingBottom: 8,
  },
  brand: { fontFamily: FONT_SERIF, fontSize: 12, color: PDF_COLORS.primary },
  meta: { fontSize: 8, color: PDF_COLORS.mutedForeground },
  footerFixed: {
    position: "absolute",
    bottom: 16,
    left: PDF_PAGE_PADDING,
    right: PDF_PAGE_PADDING,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.border,
    paddingTop: 6,
  },
  footerText: { fontSize: 7, color: PDF_COLORS.mutedForeground, flex: 1 },
  footerPage: { fontSize: 7, color: PDF_COLORS.mutedForeground },
  title: { fontFamily: FONT_SERIF, fontSize: 20, marginBottom: 2 },
  subtitle: { fontSize: 9, color: PDF_COLORS.mutedForeground, marginBottom: 10 },
  section: { marginBottom: 12 },
  sectionTitle: { fontFamily: FONT_SERIF, fontSize: 12, marginBottom: 5 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2.5,
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_COLORS.border,
  },
  rowLabel: { flex: 1, paddingRight: 8 },
  rowValue: { textAlign: "right", maxWidth: 200 },
  bold: { fontWeight: "bold" },
  note: { fontSize: 7.5, color: PDF_COLORS.mutedForeground },
  para: { fontSize: 8.5, lineHeight: 1.4, marginTop: 4 },
  callout: {
    marginTop: 6,
    padding: 6,
    backgroundColor: PDF_COLORS.warningTint,
    color: PDF_COLORS.warningForeground,
    fontSize: 8,
    lineHeight: 1.4,
  },
  totalBox: {
    marginTop: 4,
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: PDF_COLORS.primaryTint,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tableHead: {
    flexDirection: "row",
    backgroundColor: PDF_COLORS.secondary,
    paddingVertical: 3,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_COLORS.border,
  },
  cell: { paddingHorizontal: 3, fontSize: 8 },
  rulesRow: {
    flexDirection: "row",
    paddingVertical: 1.5,
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_COLORS.border,
  },
  rulesCell: { paddingHorizontal: 2, fontSize: 6.5 },
  kallaRad: {
    fontSize: 6.5,
    color: PDF_COLORS.primary,
    fontWeight: "bold",
    paddingTop: 4,
    paddingHorizontal: 2,
  },
  twoCol: { flexDirection: "row", gap: 16 },
  col: { flex: 1 },
});

const SCENARIO_BREDD = [1.5, 0.8, 1.1, 1.1, 1.5, 1.3] as const;
const REGEL_BREDD = [4, 2.2, 0.9, 1.4] as const;

function Rad({ rad }: { rad: KalkylPdfRad }) {
  return (
    <View style={styles.row} wrap={false}>
      <View style={styles.rowLabel}>
        <Text style={rad.stark === true ? styles.bold : {}}>{rad.etikett}</Text>
        {rad.not !== undefined ? <Text style={styles.note}>{rad.not}</Text> : null}
      </View>
      <Text style={[styles.rowValue, rad.stark === true ? styles.bold : {}]}>{rad.varde}</Text>
    </View>
  );
}

function Sektion({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} minPresenceAhead={40}>
        {titel}
      </Text>
      {children}
    </View>
  );
}

function Tabell({ t }: { t: KalkylPdfTabell }) {
  return (
    <View>
      <View style={styles.tableHead}>
        {t.kolumner.map((k, i) => (
          <Text key={k} style={[styles.cell, styles.bold, { flex: SCENARIO_BREDD[i] ?? 1 }]}>
            {k}
          </Text>
        ))}
      </View>
      {t.rader.map((r) => (
        <View key={r[0]} style={styles.tableRow} wrap={false}>
          {r.map((c, i) => (
            <Text key={`${r[0]}-${i}`} style={[styles.cell, { flex: SCENARIO_BREDD[i] ?? 1 }]}>
              {c}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function KalkylPdfDocument({ vm }: { vm: KalkylPdfViewModel }) {
  const k = vm.kalp;
  const halva = Math.ceil(vm.indata.length / 2);
  return (
    <Document title="Binfo bolånekalkyl" author="Binfo" language="sv">
      <Page size="A4" style={styles.page}>
        <View style={styles.headerFixed} fixed>
          <Text style={styles.brand}>Binfo</Text>
          <Text style={styles.meta}>
            Bolånekalkyl, {vm.datum}
            {vm.etikett !== null ? `, ${vm.etikett}` : ""}
          </Text>
        </View>
        <View style={styles.footerFixed} fixed>
          <Text style={styles.footerText}>{PDF_DISCLAIMER}</Text>
          <Text
            style={styles.footerPage}
            render={({ pageNumber, totalPages }) => `Sida ${pageNumber} av ${totalPages}`}
          />
        </View>

        <Text style={styles.title}>{vm.titel}</Text>
        <Text style={styles.subtitle}>
          {vm.etikett !== null ? `${vm.etikett}. ` : ""}Skapad {vm.datum}. Regelversion{" "}
          {vm.regelversion}.
        </Text>

        <Sektion titel="Indata">
          <View style={styles.twoCol}>
            <View style={styles.col}>
              {vm.indata.slice(0, halva).map((r) => (
                <Rad key={r.etikett} rad={r} />
              ))}
            </View>
            <View style={styles.col}>
              {vm.indata.slice(halva).map((r) => (
                <Rad key={r.etikett} rad={r} />
              ))}
            </View>
          </View>
        </Sektion>

        <Sektion titel="Månadskostnad">
          {vm.manadskostnad.rader.map((r) => (
            <Rad key={r.etikett} rad={r} />
          ))}
          {vm.manadskostnad.total !== null ? (
            <View style={styles.totalBox}>
              <Text style={styles.bold}>{vm.manadskostnad.total.etikett}</Text>
              <Text style={styles.bold}>{vm.manadskostnad.total.varde}</Text>
            </View>
          ) : null}
          {vm.manadskostnad.totalNot !== null ? (
            <Text style={styles.para}>{vm.manadskostnad.totalNot}</Text>
          ) : null}
        </Sektion>

        <Sektion titel="Ränteavdrag per person">
          {vm.ranteavdrag.rader.map((r) => (
            <Rad key={r.etikett} rad={r} />
          ))}
          {vm.ranteavdrag.not !== null ? (
            <Text style={styles.callout}>{vm.ranteavdrag.not}</Text>
          ) : null}
        </Sektion>

        <Sektion titel="Amortering">
          {vm.amortering.rader.map((r) => (
            <Rad key={r.etikett} rad={r} />
          ))}
          <Text style={styles.para}>{vm.amortering.regeltext}</Text>
        </Sektion>

        {vm.scenarier !== null ? (
          <Sektion titel="Om räntan ändras">
            <Tabell t={vm.scenarier} />
            <Text style={styles.para}>
              Om föreningens räntekänslighet är ifylld stressas månadsavgiften i varje scenario.
            </Text>
          </Sektion>
        ) : null}

        <Sektion titel="Bankens kalkyl (KALP)">
          {k.saknasText !== null ? <Text style={styles.para}>{k.saknasText}</Text> : null}
          {k.beraknad ? (
            <>
              <Text style={[styles.bold, { marginBottom: 2 }]}>Boende</Text>
              {k.boende.map((r) => (
                <Rad key={r.etikett} rad={r} />
              ))}
              <Text style={[styles.bold, { marginTop: 6, marginBottom: 2 }]}>
                Levnadskostnader enligt Konsumentverket
              </Text>
              {k.levnad.map((r) => (
                <Rad key={r.etikett} rad={r} />
              ))}
              {k.summaRader.map((r) => (
                <Rad key={r.etikett} rad={r} />
              ))}
              {k.utfall !== null ? (
                <View
                  style={[
                    styles.totalBox,
                    {
                      backgroundColor:
                        k.utfall.tecken === "plus" ? PDF_COLORS.successTint : PDF_COLORS.dangerTint,
                    },
                  ]}
                >
                  <Text style={styles.bold}>{k.utfall.text}</Text>
                </View>
              ) : null}
            </>
          ) : null}
          <Text style={[styles.bold, { marginTop: 6 }]}>Förutsättningar</Text>
          {k.forutsattningar.map((f) => (
            <Text key={f} style={styles.para}>
              {"• "}
              {f}
            </Text>
          ))}
        </Sektion>

        <Sektion titel="Regler och antaganden">
          <Text style={[styles.note, { marginBottom: 4 }]}>
            Schabloner och antaganden är Binfos egna uppskattningar och är märkta så. Övriga poster
            är regler eller referensvärden med källa.
          </Text>
          <View style={styles.tableHead}>
            {["Regel eller antagande", "Värde", "Gäller från", "Status"].map((h, i) => (
              <Text key={h} style={[styles.rulesCell, styles.bold, { flex: REGEL_BREDD[i] ?? 1 }]}>
                {h}
              </Text>
            ))}
          </View>
          {vm.regler.map((r, i) => (
            <View key={r.namn} wrap={false}>
              {i === 0 || vm.regler[i - 1]?.kalla !== r.kalla ? (
                <Text style={styles.kallaRad}>
                  {/ingen källa/i.test(r.kalla) ? r.kalla : `Källa: ${r.kalla}`}
                </Text>
              ) : null}
              <View style={styles.rulesRow}>
                <Text style={[styles.rulesCell, { flex: REGEL_BREDD[0] }]}>{r.namn}</Text>
                <Text style={[styles.rulesCell, { flex: REGEL_BREDD[1] }]}>{r.varde}</Text>
                <Text style={[styles.rulesCell, { flex: REGEL_BREDD[2] }]}>{r.gallerFran}</Text>
                <Text
                  style={[
                    styles.rulesCell,
                    { flex: REGEL_BREDD[3] },
                    r.arAntagande
                      ? { color: PDF_COLORS.warningForeground, fontWeight: "bold" }
                      : {},
                  ]}
                >
                  {r.status}
                </Text>
              </View>
            </View>
          ))}
        </Sektion>

        <Text style={styles.note}>{PDF_DISCLAIMER}</Text>
      </Page>
    </Document>
  );
}
