import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { FONT_SANS, FONT_SERIF } from "@/components/pdf/fonts";
import { PDF_COLORS, PDF_DISCLAIMER, PDF_PAGE_PADDING } from "@/components/pdf/theme";
import {
  buildPdfViewModel,
  type PdfKeyFigure,
  type PdfRedFlag,
  type PdfViewModel,
} from "@/components/pdf/viewModel";
import type { AnalysisResult, Status } from "@/types/analysis";

// Deliberately does NOT call registerPdfFonts() itself: react-pdf's Font
// registry appends sources rather than replacing them, so registering twice
// with different sources (e.g. production's site-relative paths vs a test's
// data: URLs) would silently keep whichever was registered first. The
// caller registers fonts once, with the sources appropriate to its
// environment — see download.tsx for the real download path and
// AnalysPdfDocument.test.tsx for the Node/test path.
const STATUS_COLOR: Record<Status, string> = {
  god: PDF_COLORS.success,
  acceptabel: PDF_COLORS.success,
  svag: PDF_COLORS.warning,
  kritisk: PDF_COLORS.danger,
  okant: PDF_COLORS.mutedForeground,
};

const SEVERITY_COLOR: Record<PdfRedFlag["severity"], string> = {
  hog: PDF_COLORS.danger,
  medel: PDF_COLORS.warning,
  lag: PDF_COLORS.warning,
};

const styles = StyleSheet.create({
  page: {
    paddingTop: PDF_PAGE_PADDING + 20,
    paddingBottom: PDF_PAGE_PADDING + 24,
    paddingHorizontal: PDF_PAGE_PADDING,
    fontFamily: FONT_SANS,
    fontSize: 10,
    color: PDF_COLORS.foreground,
    backgroundColor: PDF_COLORS.background,
    // `fontFeatureSettings` is inherited by every descendant <Text> (see
    // BASE_INHERITABLE_PROPERTIES in @react-pdf/layout), same as fontFamily
    // below — so this one declaration disables ligatures everywhere. Without
    // it, fontkit substitutes a single "fi"/"fl"/"ffi"/"ffl" ligature glyph
    // for those letter pairs (confirmed via fontkit.layout() on our exact
    // font files — IBM Plex Sans has an "fi" ligature, Libre Baskerville has
    // "fi", "fl", "ffi" and "ffl"). @react-pdf/render's generated ToUnicode
    // CMap entry for a ligature glyph is technically spec-compliant (a
    // multi-codepoint hex string with an internal space, e.g. "<0066 006c>"
    // for "fl") but several real-world PDF readers/extractors do not parse
    // that form correctly and drop or truncate it — which is exactly the
    // "fnansieras" / "Röda faggor" bug this fixes. Disabling ligature
    // selection means every glyph maps 1:1 to one Unicode codepoint, which
    // is unambiguous for any reader. Visually near-identical for these two
    // typefaces at report sizes.
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
  headerBrand: {
    fontFamily: FONT_SERIF,
    fontSize: 12,
    color: PDF_COLORS.primary,
  },
  headerMeta: {
    fontSize: 8,
    color: PDF_COLORS.mutedForeground,
  },
  footerFixed: {
    position: "absolute",
    bottom: 16,
    left: PDF_PAGE_PADDING,
    right: PDF_PAGE_PADDING,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.border,
    paddingTop: 6,
  },
  footerDisclaimer: {
    fontSize: 7,
    color: PDF_COLORS.mutedForeground,
    flex: 1,
  },
  footerPage: {
    fontSize: 7,
    color: PDF_COLORS.mutedForeground,
  },
  eyebrow: {
    fontSize: 8,
    color: PDF_COLORS.primary,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  title: {
    fontFamily: FONT_SERIF,
    fontSize: 22,
    color: PDF_COLORS.foreground,
    marginBottom: 4,
  },
  sectionTitle: {
    fontFamily: FONT_SERIF,
    fontSize: 14,
    color: PDF_COLORS.foreground,
    marginBottom: 8,
  },
  section: {
    marginBottom: 18,
  },
  card: {
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
    borderRadius: 4,
    backgroundColor: PDF_COLORS.card,
    padding: 12,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.border,
    paddingTop: 12,
  },
  summaryCell: {
    width: "33%",
    marginBottom: 8,
  },
  // The address row can hold the anonymisation fallback sentence
  // ("Adressen raderad efter 30 dagar · <ort>"), which is too long for a
  // one-third column at report width — give it the full row instead of
  // letting it wrap awkwardly under a narrow "Adress" label.
  summaryCellFull: {
    width: "100%",
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 7,
    color: PDF_COLORS.mutedForeground,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 10,
    fontWeight: "bold",
  },
  betygRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  // A <Text> node does not centre its own content the way a flex
  // container centres a child (alignItems/justifyContent on a <Text> style
  // only affect ITS children, not its own text run) — hence the circle is a
  // <View> that centres a plain <Text> child, rather than one Text node
  // styled to look like a circle.
  betygCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: PDF_COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  betygLetter: {
    fontFamily: FONT_SERIF,
    fontSize: 18,
    lineHeight: 1,
    color: PDF_COLORS.primary,
    textAlign: "center",
  },
  betygText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 1.5,
  },
  flagCard: {
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
    borderRadius: 4,
    backgroundColor: PDF_COLORS.card,
    padding: 10,
    marginBottom: 8,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
    fontSize: 7,
    fontWeight: "bold",
    marginBottom: 4,
  },
  flagTitle: {
    fontSize: 10,
    fontWeight: "bold",
    marginBottom: 3,
  },
  flagBody: {
    fontSize: 9,
    color: PDF_COLORS.mutedForeground,
    lineHeight: 1.4,
  },
  pageRefTag: {
    marginTop: 4,
    fontSize: 7,
    color: PDF_COLORS.mutedForeground,
  },
  keyFigureRow: {
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
    borderRadius: 4,
    backgroundColor: PDF_COLORS.card,
    padding: 10,
    marginBottom: 6,
  },
  keyFigureTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  keyFigureLabel: {
    fontSize: 10,
    fontWeight: "bold",
    flex: 1,
    paddingRight: 8,
  },
  keyFigureValue: {
    fontFamily: FONT_SERIF,
    fontSize: 13,
  },
  statusText: {
    fontSize: 7,
    fontWeight: "bold",
    marginBottom: 2,
  },
  forklaringText: {
    fontSize: 8,
    color: PDF_COLORS.mutedForeground,
    marginTop: 4,
    lineHeight: 1.4,
  },
  schablonTag: {
    fontSize: 6,
    fontWeight: "bold",
    color: PDF_COLORS.mutedForeground,
    backgroundColor: PDF_COLORS.secondary,
    borderRadius: 3,
    paddingVertical: 1,
    paddingHorizontal: 4,
    marginTop: 4,
    alignSelf: "flex-start",
    textTransform: "uppercase",
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.border,
  },
  priceLabel: {
    fontSize: 9,
  },
  priceValue: {
    fontFamily: FONT_SERIF,
    fontSize: 11,
  },
  conclusionBox: {
    marginTop: 10,
    backgroundColor: PDF_COLORS.secondary,
    borderRadius: 4,
    padding: 8,
    fontSize: 9,
    lineHeight: 1.4,
  },
  confidenceNote: {
    marginTop: 6,
    fontSize: 7,
    color: PDF_COLORS.mutedForeground,
    lineHeight: 1.4,
  },
  table: {
    marginTop: 6,
  },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.foreground,
    paddingBottom: 4,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.border,
    paddingVertical: 5,
  },
  tableCellHeader: {
    flex: 1,
    fontSize: 8,
    fontWeight: "bold",
    color: PDF_COLORS.mutedForeground,
    textTransform: "uppercase",
  },
  tableCell: {
    flex: 1,
    fontSize: 9,
  },
  rantestressComment: {
    marginTop: 8,
    fontSize: 9,
    color: PDF_COLORS.mutedForeground,
    lineHeight: 1.4,
  },
  fragaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.border,
  },
  checkbox: {
    width: 9,
    height: 9,
    borderWidth: 1,
    borderColor: PDF_COLORS.mutedForeground,
    marginTop: 1,
  },
  fragaText: {
    fontSize: 9,
    flex: 1,
    lineHeight: 1.4,
  },
  emptyNote: {
    fontSize: 9,
    color: PDF_COLORS.mutedForeground,
    fontStyle: "italic",
  },
});

function Header({ foreningNamn, skapadLabel }: { foreningNamn: string; skapadLabel: string }) {
  return (
    <View style={styles.headerFixed} fixed>
      <Text style={styles.headerBrand}>Binfo</Text>
      <Text style={styles.headerMeta}>
        {foreningNamn} · Analys skapad {skapadLabel}
      </Text>
    </View>
  );
}

function Footer() {
  return (
    <View style={styles.footerFixed} fixed>
      <Text style={styles.footerDisclaimer}>{PDF_DISCLAIMER}</Text>
      <Text
        style={styles.footerPage}
        render={({ pageNumber, totalPages }) => `Sida ${pageNumber} av ${totalPages}`}
      />
    </View>
  );
}

function Summary({ vm }: { vm: PdfViewModel }) {
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.eyebrow}>Binfo-analys</Text>
      <Text style={styles.title}>{vm.foreningNamn}</Text>
      <View style={styles.summaryGrid}>
        {vm.summary.map((row) => (
          <View
            key={row.label}
            style={row.label === "Adress" ? styles.summaryCellFull : styles.summaryCell}
          >
            <Text style={styles.summaryLabel}>{row.label}</Text>
            <Text style={styles.summaryValue}>{row.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Betyg({ vm }: { vm: PdfViewModel }) {
  return (
    <View style={[styles.section, styles.card, styles.betygRow]} wrap={false}>
      <View style={styles.betygCircle}>
        <Text style={styles.betygLetter}>{vm.betyg}</Text>
      </View>
      <Text style={styles.betygText}>{vm.betygMotivering}</Text>
    </View>
  );
}

function RodaFlaggor({ flaggor }: { flaggor: PdfRedFlag[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Röda flaggor</Text>
      {flaggor.length === 0 ? (
        <Text style={styles.emptyNote}>Inga röda flaggor identifierade.</Text>
      ) : (
        flaggor.map((flagga) => (
          <View key={flagga.id} style={styles.flagCard} wrap={false}>
            <Text
              style={[
                styles.badge,
                { color: SEVERITY_COLOR[flagga.severity], backgroundColor: PDF_COLORS.secondary },
              ]}
            >
              {flagga.severityLabel}
            </Text>
            <Text style={styles.flagTitle}>{flagga.titel}</Text>
            <Text style={styles.flagBody}>{flagga.beskrivning}</Text>
            {flagga.pageRef ? <Text style={styles.pageRefTag}>{flagga.pageRef}</Text> : null}
          </View>
        ))
      )}
    </View>
  );
}

function Foreningsekonomi({ keyFigures }: { keyFigures: PdfKeyFigure[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Föreningens ekonomi</Text>
      {keyFigures.map((kf) => (
        <View key={kf.id} style={styles.keyFigureRow} wrap={false}>
          <Text style={[styles.statusText, { color: STATUS_COLOR[kf.status] }]}>
            {kf.statusLabel}
          </Text>
          <View style={styles.keyFigureTop}>
            <Text style={styles.keyFigureLabel}>{kf.label}</Text>
            <Text style={styles.keyFigureValue}>{kf.valueText}</Text>
          </View>
          <Text style={styles.forklaringText}>
            {kf.forklaring}
            {kf.benchmarkText ? `  (${kf.benchmarkText})` : ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {kf.isSchablon ? <Text style={styles.schablonTag}>Schablon</Text> : null}
            {kf.pageRef ? <Text style={styles.pageRefTag}>{kf.pageRef}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function Prisrimlighet({ vm }: { vm: PdfViewModel }) {
  const p = vm.prisanalys;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Är priset rimligt?</Text>
      <View style={styles.card} wrap={false}>
        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>Utgångspris</Text>
          <Text style={styles.priceValue}>{p.utgangspris}</Text>
        </View>
        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>Pris per kvadratmeter</Text>
          <Text style={styles.priceValue}>{p.prisPerM2}</Text>
        </View>
        {p.externVardering ? (
          <View style={[styles.priceRow, { borderBottomWidth: 0 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.priceLabel}>
                Extern värdering{p.externVardering.isSchablon ? " (schablon)" : ""}
              </Text>
              <Text style={[styles.summaryLabel, { marginTop: 2 }]}>
                {p.externVardering.leverantor}
              </Text>
            </View>
            <View>
              <Text style={styles.priceValue}>{p.externVardering.value}</Text>
              {p.avvikelseText ? <Text style={styles.summaryLabel}>{p.avvikelseText}</Text> : null}
            </View>
          </View>
        ) : null}
        <Text style={styles.conclusionBox}>{p.slutsats}</Text>
        {p.konfidensSkal.length > 0 ? (
          <Text style={styles.confidenceNote}>
            Låg tillförlitlighet ({p.konfidensNiva}): {p.konfidensSkal.join(" ")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Rantestress({ vm }: { vm: PdfViewModel }) {
  const r = vm.rantestress;
  const showTotal = r.rader.some((rad) => rad.totalManadskostnad !== undefined);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Vad händer om räntan stiger?</Text>
      <View style={styles.card} wrap={false}>
        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>Dagens avgift</Text>
          <Text style={styles.priceValue}>{r.nuvarandeManadsavgift}</Text>
        </View>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.tableCellHeader}>Räntehöjning</Text>
            <Text style={styles.tableCellHeader}>Ny avgift/mån</Text>
            <Text style={styles.tableCellHeader}>Ökning kr/mån</Text>
            {showTotal ? <Text style={styles.tableCellHeader}>Total månadskostnad</Text> : null}
          </View>
          {r.rader.map((rad) => (
            <View key={rad.okningPe} style={styles.tableRow}>
              <Text style={styles.tableCell}>+{rad.okningPe} p.e.</Text>
              <Text style={styles.tableCell}>{rad.nyManadsavgift}</Text>
              <Text style={styles.tableCell}>{rad.avgiftsokning}</Text>
              {showTotal ? (
                <Text style={styles.tableCell}>{rad.totalManadskostnad ?? "—"}</Text>
              ) : null}
            </View>
          ))}
        </View>
        <Text style={styles.rantestressComment}>{r.kommentar}</Text>
      </View>
    </View>
  );
}

function Fragor({ fragor }: { fragor: PdfViewModel["fragor"] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Frågor att ställa</Text>
      {fragor.length === 0 ? (
        <Text style={styles.emptyNote}>Inga frågor genererade.</Text>
      ) : (
        <View style={styles.card}>
          {fragor.map((f) => (
            <View key={f.id} style={styles.fragaRow} wrap={false}>
              <View style={styles.checkbox} />
              <Text style={styles.fragaText}>{f.fraga}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * The full analysis, flattened to a printable A4 PDF — everything
 * AnalysRapport.tsx (the on-screen report) renders, laid out for paper
 * instead of a browser (see download.tsx for how this is turned into a
 * downloaded file, and CLAUDE.md's "Visual boundary" for why this layout —
 * unlike the rest of the app — is not bound to the site's existing
 * components).
 */
export function AnalysPdfDocument({ analys }: { analys: AnalysisResult }) {
  const vm = buildPdfViewModel(analys);
  return (
    <Document
      title={`Binfo-analys — ${vm.foreningNamn}`}
      author="Binfo"
      subject="Bostadsrättsanalys"
    >
      <Page size="A4" style={styles.page}>
        <Header foreningNamn={vm.foreningNamn} skapadLabel={vm.skapadLabel} />
        <Summary vm={vm} />
        <Betyg vm={vm} />
        <RodaFlaggor flaggor={vm.rodaFlaggor} />
        <Foreningsekonomi keyFigures={vm.keyFigures} />
        <Prisrimlighet vm={vm} />
        <Rantestress vm={vm} />
        <Fragor fragor={vm.fragor} />
        <Footer />
      </Page>
    </Document>
  );
}
