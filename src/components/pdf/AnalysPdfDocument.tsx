import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { ForsaljningarSvar } from "@/lib/annons/forsaljningar";
import type { ForsaljningarVy } from "@/lib/annons/forsaljningarVy";
import { FONT_SANS, FONT_SERIF, WEIGHT_SEMIBOLD } from "@/components/pdf/fonts";
import { layoutSpanBar, SPAN_LABEL_BREDD, type SpanMarkorTon } from "@/components/pdf/spanLayout";
import {
  PDF_COLORS,
  PDF_DISCLAIMER,
  PDF_GRADE_COLORS,
  PDF_PAGE_PADDING,
} from "@/components/pdf/theme";
import {
  buildPdfViewModel,
  FLAGGA_ETIKETT,
  type PdfAvgiften,
  type PdfForening,
  type PdfFragor,
  type PdfKort,
  type PdfPriset,
  type PdfRad,
  type PdfViewModel,
} from "@/components/pdf/viewModel";
import type { Ton } from "@/lib/analysisView";
import type { AnalysisResult, Grade } from "@/types/analysis";

// Deliberately does NOT call registerPdfFonts() itself: react-pdf's Font
// registry appends sources rather than replacing them, so registering twice
// with different sources (e.g. production's site-relative paths vs a test's
// data: URLs) would silently keep whichever was registered first. The
// caller registers fonts once, with the sources appropriate to its
// environment — see download.tsx for the real download path and the tests
// (pdfTestFonts.ts) for the Node path.

const SEMI = WEIGHT_SEMIBOLD;
const BREDD = 595.28 - 2 * PDF_PAGE_PADDING;

const TON_TEXT: Record<Ton, string> = {
  success: PDF_COLORS.successText,
  warning: PDF_COLORS.warningText,
  danger: PDF_COLORS.dangerText,
  neutral: PDF_COLORS.muted,
};

const PILL: Record<"success" | "warning" | "danger" | "neutral" | "info", [string, string]> = {
  success: [PDF_COLORS.successTint, PDF_COLORS.successText],
  warning: [PDF_COLORS.warningTint, PDF_COLORS.warningText],
  danger: [PDF_COLORS.dangerTint, PDF_COLORS.dangerText],
  neutral: [PDF_COLORS.divider, PDF_COLORS.muted],
  info: [PDF_COLORS.tint, PDF_COLORS.link],
};

const SPAN_TON: Record<SpanMarkorTon, string> = {
  utgangspris: PDF_COLORS.ink,
  bud: PDF_COLORS.link,
  vardering: PDF_COLORS.navy,
  liknande: PDF_COLORS.muted,
};

const styles = StyleSheet.create({
  page: {
    paddingTop: PDF_PAGE_PADDING + 22,
    paddingBottom: PDF_PAGE_PADDING + 26,
    paddingHorizontal: PDF_PAGE_PADDING,
    fontFamily: FONT_SANS,
    fontSize: 9.5,
    lineHeight: 1.4,
    color: PDF_COLORS.ink,
    backgroundColor: PDF_COLORS.page,
    // Inherited by every <Text>: without it fontkit substitutes a single "fi"/"fl"
    // ligature glyph whose ToUnicode entry several PDF readers drop or truncate
    // ("fnansieras", "Röda faggor"). One glyph per codepoint extracts cleanly.
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
    paddingBottom: 7,
  },
  headerBrand: {
    fontFamily: FONT_SERIF,
    fontWeight: SEMI,
    fontSize: 13,
    lineHeight: 1.2,
    color: PDF_COLORS.navy,
  },
  headerMeta: { fontSize: 8, color: PDF_COLORS.muted },
  // The footer is built from separate absolutely positioned fixed nodes: react-pdf drops plain
  // text inside a fixed row that also holds a `render` text once the document has several pages.
  footerLinje: {
    position: "absolute",
    top: 841.89 - 16 - 26,
    left: PDF_PAGE_PADDING,
    right: PDF_PAGE_PADDING,
    height: 1,
    backgroundColor: PDF_COLORS.border,
  },
  footerText: {
    position: "absolute",
    top: 841.89 - 16 - 20,
    left: PDF_PAGE_PADDING,
    width: BREDD - 170,
    fontSize: 7,
    color: PDF_COLORS.muted,
  },
  footerSida: {
    position: "absolute",
    top: 841.89 - 16 - 20,
    right: PDF_PAGE_PADDING,
    width: 150,
    textAlign: "right",
    fontSize: 7,
    color: PDF_COLORS.muted,
  },
  footerKontakt: {
    position: "absolute",
    top: 841.89 - 16 - 10,
    right: PDF_PAGE_PADDING,
    width: 150,
    textAlign: "right",
    fontSize: 7,
    color: PDF_COLORS.muted,
  },

  eyebrow: {
    fontSize: 8,
    fontWeight: SEMI,
    color: PDF_COLORS.link,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  h1: {
    fontFamily: FONT_SERIF,
    fontWeight: SEMI,
    fontSize: 25,
    lineHeight: 1.15,
    color: PDF_COLORS.navy,
    marginTop: 4,
  },
  meta: { fontSize: 10.5, color: PDF_COLORS.text2, marginTop: 5, lineHeight: 1.4 },
  metaRad: { fontSize: 9, color: PDF_COLORS.text2, marginTop: 3 },

  kortRad: { flexDirection: "row", gap: 10, marginTop: 16 },
  kort: {
    flex: 1,
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
    borderTopWidth: 2.5,
    borderTopColor: PDF_COLORS.navy,
    borderRadius: 6,
    padding: 10,
  },
  kortStort: {
    fontFamily: FONT_SERIF,
    fontWeight: SEMI,
    fontSize: 16,
    lineHeight: 1.2,
    color: PDF_COLORS.navy,
    marginTop: 8,
  },
  kortRad2: { fontSize: 9, fontWeight: SEMI, marginTop: 5 },
  kortText: { fontSize: 8.5, color: PDF_COLORS.text2, marginTop: 4, lineHeight: 1.4 },

  sektion: { marginTop: 26 },
  h2: {
    fontFamily: FONT_SERIF,
    fontWeight: SEMI,
    fontSize: 17,
    lineHeight: 1.2,
    color: PDF_COLORS.navy,
    marginTop: 3,
  },
  lead: { fontSize: 10, color: PDF_COLORS.text2, marginTop: 5, lineHeight: 1.45 },
  h3: { fontWeight: SEMI, fontSize: 11.5, color: PDF_COLORS.ink, marginBottom: 4 },
  h4: { fontWeight: SEMI, fontSize: 10, color: PDF_COLORS.ink, marginBottom: 3 },

  card: {
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
    borderRadius: 6,
    padding: 12,
    marginTop: 10,
  },
  flagga: {
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
    borderRadius: 6,
    padding: 9,
    marginTop: 7,
  },
  flaggaTopp: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  flaggaTitel: { fontWeight: SEMI, fontSize: 10.5, marginTop: 5 },
  body: { fontSize: 9, color: PDF_COLORS.text2, marginTop: 2, lineHeight: 1.4 },
  small: { fontSize: 8, color: PDF_COLORS.muted, lineHeight: 1.4 },
  sida: { fontSize: 8, color: PDF_COLORS.muted },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingVertical: 1.5,
    paddingHorizontal: 6,
    fontSize: 7.5,
    fontWeight: SEMI,
  },
  tag: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
    borderRadius: 3,
    paddingVertical: 0.5,
    paddingHorizontal: 4,
    fontSize: 7,
    fontWeight: SEMI,
    color: PDF_COLORS.muted,
  },
  callout: { borderWidth: 1, borderRadius: 6, padding: 9, marginTop: 10 },
  calloutTitel: { fontWeight: SEMI, fontSize: 9.5 },

  tabell: { marginTop: 10 },
  tabellHuvud: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: PDF_COLORS.divider,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  tabellHuvudCell: { fontSize: 7.5, fontWeight: SEMI, color: PDF_COLORS.muted },
  tabellRad: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.border,
  },
  cell: { fontSize: 9, paddingRight: 6 },

  vardeRad: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.divider,
  },
  vardeVanster: { flex: 1, paddingRight: 12 },
  vardeHoger: { width: 140, alignItems: "flex-end" },

  box: {
    flex: 1,
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
    borderRadius: 6,
    padding: 10,
  },
  boxTint: { flex: 1, backgroundColor: PDF_COLORS.tint, borderRadius: 6, padding: 10 },
  boxStort: {
    fontFamily: FONT_SERIF,
    fontWeight: SEMI,
    fontSize: 15,
    lineHeight: 1.2,
    marginTop: 2,
  },

  fraga: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.divider,
  },
  checkbox: {
    width: 9,
    height: 9,
    borderWidth: 1,
    borderColor: PDF_COLORS.muted,
    borderRadius: 2,
    marginTop: 2,
  },
  punkt: { fontSize: 8.5, color: PDF_COLORS.muted, lineHeight: 1.4, marginTop: 2 },
});

// ------------------------------------------------------------------ small parts

function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

function Pill({
  ton,
  label,
}: {
  ton: "success" | "warning" | "danger" | "neutral" | "info";
  label: string;
}) {
  const [bg, fg] = PILL[ton];
  return <Text style={[styles.pill, { backgroundColor: bg, color: fg }]}>{label}</Text>;
}

function Tag({ children }: { children: string }) {
  return <Text style={styles.tag}>{children}</Text>;
}

function SektionsRubrik({
  nummer,
  eyebrow,
  titel,
  lead,
}: {
  nummer: string;
  eyebrow: string;
  titel: string;
  lead?: string | undefined;
}) {
  return (
    <View minPresenceAhead={90}>
      <Eyebrow>
        {nummer} · {eyebrow}
      </Eyebrow>
      <Text style={styles.h2}>{titel}</Text>
      {lead ? <Text style={styles.lead}>{lead}</Text> : null}
    </View>
  );
}

function Callout({
  variant,
  titel,
  children,
}: {
  variant: "notice" | "flag";
  titel: string;
  children: ReactNode;
}) {
  const [bg, border, fg] =
    variant === "flag"
      ? [PDF_COLORS.dangerTint, PDF_COLORS.danger, PDF_COLORS.dangerText]
      : [PDF_COLORS.noticeTint, PDF_COLORS.noticeBorder, PDF_COLORS.noticeText];
  return (
    <View style={[styles.callout, { backgroundColor: bg, borderColor: border }]} wrap={false}>
      <Text style={[styles.calloutTitel, { color: fg }]}>{titel}</Text>
      <Text style={{ fontSize: 9, color: fg, marginTop: 2 }}>{children}</Text>
    </View>
  );
}

interface Kolumn {
  titel: string;
  flex: number;
  hoger?: boolean;
}

/** A bordered table; `rader` hold ready-made cells (strings or nodes). */
function Tabell({
  kolumner,
  rader,
  foot,
}: {
  kolumner: Kolumn[];
  rader: Array<{ key: string; celler: ReactNode[] }>;
  foot?: ReactNode;
}) {
  return (
    <View style={styles.tabell}>
      <View style={styles.tabellHuvud} wrap={false} minPresenceAhead={60}>
        {kolumner.map((k) => (
          <Text
            key={k.titel}
            style={[
              styles.tabellHuvudCell,
              { flex: k.flex, textAlign: k.hoger ? "right" : "left" },
            ]}
          >
            {k.titel}
          </Text>
        ))}
      </View>
      {rader.map((r) => (
        <View key={r.key} style={styles.tabellRad} wrap={false}>
          {r.celler.map((c, i) => (
            <View
              key={`${r.key}-${i}`}
              style={{
                flex: kolumner[i]?.flex ?? 1,
                paddingRight: 6,
                alignItems: kolumner[i]?.hoger ? "flex-end" : "flex-start",
              }}
            >
              {typeof c === "string" ? <Text style={styles.cell}>{c}</Text> : c}
            </View>
          ))}
        </View>
      ))}
      {foot}
    </View>
  );
}

function Namn({ label, forklaring, sida }: { label: string; forklaring?: string; sida?: string }) {
  return (
    <View>
      <Text style={{ fontWeight: SEMI, fontSize: 9.5 }}>{label}</Text>
      {forklaring ? (
        <Text style={styles.small}>
          {forklaring}
          {sida ? ` (${sida})` : ""}
        </Text>
      ) : null}
    </View>
  );
}

/** A label/note on the left and a value (with optional line under it) on the right. */
function VardeLista({ rader }: { rader: PdfRad[] }) {
  return (
    <View>
      {rader.map((r) => (
        <View key={r.label} style={styles.vardeRad} wrap={false}>
          <View style={styles.vardeVanster}>
            <Text style={{ fontWeight: SEMI, fontSize: 9.5 }}>{r.label}</Text>
            {r.note ? <Text style={styles.small}>{r.note}</Text> : null}
          </View>
          <View style={styles.vardeHoger}>
            <Text
              style={
                r.total
                  ? {
                      fontFamily: FONT_SERIF,
                      fontWeight: SEMI,
                      fontSize: 13,
                      lineHeight: 1.3,
                      marginBottom: 2,
                      color: PDF_COLORS.navy,
                    }
                  : { fontWeight: SEMI, fontSize: 10 }
              }
            >
              {r.varde}
            </Text>
            {r.undertext ? <Text style={styles.small}>{r.undertext}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ page chrome

function Header({ foreningNamn, skapadLabel }: { foreningNamn: string; skapadLabel: string }) {
  return (
    <View style={styles.headerFixed} fixed>
      <Text style={styles.headerBrand}>Binfo</Text>
      <Text style={styles.headerMeta}>
        {foreningNamn} · Rapport {skapadLabel}
      </Text>
    </View>
  );
}

function Footer({ kontakt }: { kontakt: string | null }) {
  return (
    <>
      <View style={styles.footerLinje} fixed />
      <Text style={styles.footerText} fixed>
        {PDF_DISCLAIMER}
      </Text>
      <Text
        style={styles.footerSida}
        fixed
        render={({ pageNumber, totalPages }) => `Sida ${pageNumber} av ${totalPages}`}
      />
      {kontakt !== null ? (
        <Text style={styles.footerKontakt} fixed>
          {kontakt}
        </Text>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ huvud + kort

function Huvud({ vm }: { vm: PdfViewModel }) {
  const h = vm.huvud;
  return (
    <View>
      <Eyebrow>{h.eyebrow}</Eyebrow>
      <Text style={styles.h1}>{h.titel}</Text>
      <Text style={styles.meta}>{h.meta}</Text>
      {h.byggarRad ? <Text style={styles.metaRad}>{h.byggarRad}</Text> : null}
    </View>
  );
}

function BetygBadge({ betyg }: { betyg: Grade }) {
  return (
    <View
      style={{
        width: 30,
        height: 30,
        borderRadius: 7,
        backgroundColor: PDF_GRADE_COLORS[betyg],
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontFamily: FONT_SERIF,
          fontWeight: SEMI,
          fontSize: 17,
          lineHeight: 1,
          color: "#FFFFFF",
          textAlign: "center",
        }}
      >
        {betyg}
      </Text>
    </View>
  );
}

function BetygSkala({ betyg }: { betyg: Grade }) {
  return (
    <View style={{ flexDirection: "row", gap: 3, alignItems: "flex-end" }}>
      {(["A", "B", "C", "D", "E"] as const).map((b) => (
        <View key={b} style={{ alignItems: "center", gap: 2 }}>
          <View
            style={{
              width: 16,
              height: 4,
              borderRadius: 2,
              backgroundColor: b === betyg ? PDF_GRADE_COLORS[b] : PDF_COLORS.scaleOff,
            }}
          />
          <Text
            style={{
              fontSize: 7,
              lineHeight: 1,
              fontWeight: b === betyg ? SEMI : 400,
              color: b === betyg ? PDF_GRADE_COLORS[b] : PDF_COLORS.scaleOffText,
            }}
          >
            {b}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Sammanfattningskort({ kort }: { kort: PdfKort }) {
  return (
    <View style={styles.kortRad} wrap={false}>
      <View style={styles.kort}>
        <Eyebrow>Föreningen</Eyebrow>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 8 }}>
          <BetygBadge betyg={kort.forening.betyg} />
          <BetygSkala betyg={kort.forening.betyg} />
        </View>
        <Text style={styles.kortRad2}>{kort.forening.titel}</Text>
        <Text style={styles.kortText}>{kort.forening.text}</Text>
      </View>
      <View style={styles.kort}>
        <Eyebrow>Binfos värdering</Eyebrow>
        <Text style={styles.kortStort}>{kort.varde.stort}</Text>
        {kort.varde.rad ? <Text style={styles.kortRad2}>{kort.varde.rad}</Text> : null}
        <Text style={styles.kortText}>{kort.varde.text}</Text>
      </View>
      <View style={styles.kort}>
        <Eyebrow>Avgiften framåt</Eyebrow>
        <Text style={styles.kortStort}>{kort.avgift.stort}</Text>
        {kort.avgift.rad ? <Text style={styles.kortRad2}>{kort.avgift.rad}</Text> : null}
        <Text style={styles.kortText}>{kort.avgift.text}</Text>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ 1 Föreningen

function Foreningen({ f }: { f: PdfForening }) {
  return (
    <View style={styles.sektion}>
      <SektionsRubrik nummer="1" eyebrow="Föreningen" titel={f.rubrik} lead={f.lead} />

      {f.flaggor.length === 0 ? (
        <Text style={[styles.body, { marginTop: 8, fontStyle: "normal" }]}>
          Inga röda flaggor identifierade.
        </Text>
      ) : (
        f.flaggor.map((flagga) => (
          <View key={flagga.id} style={styles.flagga} wrap={false}>
            <View style={styles.flaggaTopp}>
              <Pill ton={flagga.ton} label={FLAGGA_ETIKETT} />
              {flagga.pageRef ? <Text style={styles.sida}>{flagga.pageRef}</Text> : null}
            </View>
            <Text style={styles.flaggaTitel}>{flagga.titel}</Text>
            <Text style={styles.body}>{flagga.beskrivning}</Text>
          </View>
        ))
      )}

      {f.skannadNotis ? (
        <Callout variant="notice" titel="Skannad årsredovisning">
          {f.skannadNotis}
        </Callout>
      ) : null}

      <Tabell
        kolumner={[
          { titel: "Nyckeltal", flex: 2.9 },
          { titel: "Värde", flex: 1.4 },
          { titel: "Bedömning", flex: 1.6 },
          { titel: "Jämförelse", flex: 1.9 },
          { titel: "Källa", flex: 0.9 },
        ]}
        rader={f.nyckeltal.map((kf) => ({
          key: kf.id,
          celler: [
            <Namn key="n" label={kf.label} forklaring={kf.forklaring} />,
            <View key="v">
              <Text style={{ fontWeight: SEMI, fontSize: 9.5 }}>{kf.varde}</Text>
              {kf.osaker ? (
                <Text style={{ fontSize: 7.5, color: PDF_COLORS.warningText }}>
                  Osäker: {kf.osaker}
                </Text>
              ) : null}
            </View>,
            <Pill key="b" ton={kf.bedomningTon} label={kf.bedomning} />,
            <Text key="j" style={[styles.cell, { color: PDF_COLORS.muted, fontSize: 8.5 }]}>
              {kf.jamforelse}
            </Text>,
            <View key="k">
              {kf.pageRef ? <Text style={styles.sida}>{kf.pageRef}</Text> : null}
              {kf.isSchablon ? <Tag>Schablon</Tag> : null}
            </View>,
          ],
        }))}
      />

      {f.merUr ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.h3}>Mer ur årsredovisningen</Text>
          {f.merUr.handelser.length > 0 ? (
            <View wrap={false}>
              <Text style={styles.h4}>Väsentliga händelser</Text>
              {f.merUr.handelser.map((h, i) => (
                <Text key={`h-${i}`} style={styles.body}>
                  {"• "}
                  {h.text}{" "}
                  <Text style={styles.sida}>
                    {h.pageRef ? `(${h.pageRef})` : "(ingen exakt sidhänvisning)"}
                  </Text>
                </Text>
              ))}
            </View>
          ) : null}
          {f.merUr.ingar ? (
            <View style={{ marginTop: 6 }} wrap={false}>
              <Text style={styles.h4}>I avgiften</Text>
              <Text style={styles.body}>{f.merUr.ingar}</Text>
            </View>
          ) : null}
          {f.merUr.fakta ? (
            <View style={{ marginTop: 6 }} wrap={false}>
              <Text style={styles.h4}>Föreningen</Text>
              <Text style={styles.body}>{f.merUr.fakta}</Text>
            </View>
          ) : null}
          {f.merUr.skal.length > 0 ? (
            <View style={{ marginTop: 6 }} wrap={false}>
              <Text style={styles.h4}>Om extraktionens tillförlitlighet</Text>
              {f.merUr.skal.map((s, i) => (
                <Text key={`s-${i}`} style={styles.punkt}>
                  {"• "}
                  {s}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ 2 Priset

function SpannStapel({ spann }: { spann: NonNullable<PdfPriset["spann"]> }) {
  const bredd = BREDD - 26;
  const l = layoutSpanBar(spann.lag, spann.hog, spann.markorer, bredd);
  const RAD_H = 27;
  const over = l.radOver * RAD_H;
  const barTop = over + 8;
  const tickTop = over;
  const hojd = over + 22 + l.radUnder * RAD_H;
  return (
    <View style={{ width: bredd, height: hojd, marginTop: 6 }} wrap={false}>
      <View
        style={{
          position: "absolute",
          left: 0,
          top: barTop,
          width: bredd,
          height: 6,
          borderRadius: 2,
          backgroundColor: PDF_COLORS.track,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: l.spannVanster,
          top: barTop,
          width: l.spannBredd,
          height: 6,
          borderRadius: 2,
          backgroundColor: PDF_COLORS.span,
        }}
      />
      {l.markorer.map((m) => {
        const top = m.sida === "over" ? over - RAD_H * (m.rad + 1) : over + 22 + RAD_H * m.rad;
        return (
          <View key={`${m.label}-${m.varde}`}>
            <View
              style={{
                position: "absolute",
                left: m.x - 1.5,
                top: tickTop,
                width: 3,
                height: 22,
                borderRadius: 1,
                backgroundColor: SPAN_TON[m.ton],
              }}
            />
            <View
              style={{
                position: "absolute",
                left: m.labelLeft,
                top,
                width: SPAN_LABEL_BREDD,
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 7.5, color: PDF_COLORS.muted, textAlign: "center" }}>
                {m.label}
              </Text>
              <Text
                style={{
                  fontSize: 9.5,
                  fontWeight: SEMI,
                  color: SPAN_TON[m.ton],
                  textAlign: "center",
                }}
              >
                {m.text}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function PrisRakning({ r }: { r: NonNullable<PdfPriset["rakning"]> }) {
  return (
    <View style={{ marginTop: 14 }}>
      <View wrap={false}>
        <Text style={styles.h3}>Så har vi räknat</Text>
        {r.modell ? (
          <>
            <Text style={styles.h4}>Värderingsmodellen</Text>
            <Text style={styles.body}>{r.modell.intro}</Text>
          </>
        ) : null}
      </View>
      {r.modell ? (
        <View>
          {r.modell.faktorer.map((f) => (
            <Text key={f} style={styles.punkt}>
              {"• "}
              {f}
            </Text>
          ))}
          <Text style={styles.body}>{r.modell.kalla}</Text>
          {r.modell.spannText ? <Text style={styles.body}>{r.modell.spannText}</Text> : null}
          <Text style={[styles.small, { marginTop: 4 }]}>{r.modell.omradeText}</Text>
          <Text style={styles.small}>{r.modell.metadata}</Text>
          {r.modell.metodText ? <Text style={styles.small}>{r.modell.metodText}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function Priset({ p }: { p: PdfPriset }) {
  return (
    <View style={styles.sektion}>
      <SektionsRubrik nummer="2" eyebrow="Priset" titel={p.rubrik} lead={p.lead} />

      {p.tackning ? (
        <Callout
          variant={p.tackning.typ === "utanfor_lan" ? "flag" : "notice"}
          titel={p.tackning.titel}
        >
          {p.tackning.text}
        </Callout>
      ) : null}

      <View style={{ marginTop: 10 }}>
        {p.spann ? (
          <View wrap={false}>
            <Text style={styles.h3}>Rimligt prisspann</Text>
            <Text style={styles.small}>{p.spann.underrubrik}</Text>
            <SpannStapel spann={p.spann} />
          </View>
        ) : (
          <View>
            <Text style={styles.h3}>Binfos värdering</Text>
            <Text style={styles.body}>Inte tillgänglig — postnumret saknas eller är ogiltigt</Text>
          </View>
        )}

        {p.annons ? (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.h3}>Priset i annonsen</Text>
            <VardeLista rader={p.annons} />
          </View>
        ) : null}

        {p.harVardering ? (
          <View style={{ marginTop: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <Text style={[styles.h3, { marginBottom: 0 }]}>Binfos värdering</Text>
              {p.uppskattning ? <Tag>Uppskattning</Tag> : null}
            </View>
            {p.leverantor ? <Text style={styles.small}>Värdering: {p.leverantor}</Text> : null}
            <VardeLista rader={p.vardering} />
          </View>
        ) : null}

        {p.byggarNotis ? (
          <Text style={[styles.small, { marginTop: 10 }]}>{p.byggarNotis}</Text>
        ) : null}
        {p.skuld ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.body}>
              {p.skuld.text}
              {p.skuld.pageRef ? ` (${p.skuld.pageRef})` : ""}
            </Text>
            {p.skuld.osaker ? (
              <Text style={{ fontSize: 8, color: PDF_COLORS.warningText }}>
                Osäker: {p.skuld.osaker}
              </Text>
            ) : null}
          </View>
        ) : null}
        {p.lagTillforlitlighet ? (
          <Text style={[styles.small, { marginTop: 8 }]}>{p.lagTillforlitlighet}</Text>
        ) : null}
      </View>

      {p.rakning ? <PrisRakning r={p.rakning} /> : null}
    </View>
  );
}

const FORS_KOLUMNER = [
  { rubrik: "Såld", bredd: "16%" },
  { rubrik: "Pris", bredd: "24%" },
  { rubrik: "kr/m²", bredd: "16%" },
  { rubrik: "Storlek", bredd: "26%" },
  { rubrik: "Avgift", bredd: "18%" },
] as const;

function Forsaljningar({ f }: { f: ForsaljningarVy }) {
  return (
    <View style={{ marginTop: 14 }} wrap={false}>
      <Text style={styles.h3}>{f.rubrik}</Text>
      <View style={{ flexDirection: "row", marginTop: 4 }}>
        {FORS_KOLUMNER.map((k) => (
          <Text key={k.rubrik} style={[styles.small, { width: k.bredd }]}>
            {k.rubrik}
          </Text>
        ))}
      </View>
      {f.rader.map((r, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            borderTopWidth: 0.5,
            borderTopColor: PDF_COLORS.border,
            paddingVertical: 3,
          }}
        >
          {[r.sald, r.pris, r.krPerM2, r.storlek, r.avgift].map((v, j) => (
            <Text key={j} style={[styles.body, { width: FORS_KOLUMNER[j]?.bredd ?? "20%" }]}>
              {v}
            </Text>
          ))}
        </View>
      ))}
      <Text style={[styles.small, { marginTop: 4 }]}>
        {f.fotnot} {f.attributionText}.
      </Text>
    </View>
  );
}

// ------------------------------------------------------------------ 3 Avgiften framåt

function RantaBoxar({ a }: { a: PdfAvgiften }) {
  const r = a.rantestress;
  return (
    <View style={{ marginTop: 10 }}>
      <View minPresenceAhead={130}>
        <Text style={styles.h3}>Om föreningens ränta stiger en procentenhet</Text>
      </View>
      {r.boxar.map((b) => (
        <View
          key={b.vanster.etikett}
          style={{ flexDirection: "row", gap: 8, marginTop: 5 }}
          wrap={false}
        >
          <View style={styles.box}>
            <Text style={styles.small}>
              {b.vanster.etikett}
              {b.vanster.tryck ? ` · ${b.vanster.tryck}` : ""}
            </Text>
            <Text style={styles.boxStort}>{b.vanster.varde}</Text>
            <Text style={styles.small}>{b.vanster.under}</Text>
          </View>
          <View style={styles.boxTint}>
            <Text style={{ fontSize: 8, fontWeight: SEMI, color: PDF_COLORS.link }}>
              {b.hoger.etikett}
            </Text>
            {b.hoger.saknas !== undefined ? (
              <Text style={{ fontSize: 9, marginTop: 2 }}>{b.hoger.saknas}</Text>
            ) : (
              <>
                <Text style={styles.boxStort}>{b.hoger.varde}</Text>
                <Text style={styles.small}>{b.hoger.under}</Text>
              </>
            )}
          </View>
        </View>
      ))}

      {r.prognosTabell ? (
        <Tabell
          kolumner={[
            { titel: "Avgift per månad", flex: 3 },
            { titel: "Månadsavgift (kr)", flex: 1.4, hoger: true },
            { titel: "Förändring (kr/mån)", flex: 1.4, hoger: true },
          ]}
          rader={r.prognosTabell.rader.map((rad, i) => ({
            key: `p-${i}`,
            celler: [rad.label, rad.manadsavgift, rad.forandring],
          }))}
        />
      ) : r.rader.length > 0 ? (
        <Tabell
          kolumner={[
            { titel: "Scenario", flex: 2.2 },
            { titel: "Ny månadsavgift", flex: 1.6, hoger: true },
            { titel: "Avgiftsökning", flex: 1.6, hoger: true },
          ]}
          rader={r.rader.map((rad) => ({
            key: `s-${rad.okningPe}`,
            celler: [
              rad.okningPe === 0
                ? "Idag"
                : `+${rad.okningPe} ${rad.okningPe === 1 ? "procentenhet" : "procentenheter"}`,
              rad.nyManadsavgift,
              rad.avgiftsokning,
            ],
          }))}
        />
      ) : null}
      <Text style={[styles.body, { marginTop: 6 }]}>
        {r.prognosTabell ? r.prognosTabell.kommentar : r.kommentar}
      </Text>
    </View>
  );
}

function Avgiften({ a }: { a: PdfAvgiften }) {
  const d = a.drivare;
  return (
    <View style={styles.sektion}>
      <SektionsRubrik nummer="3" eyebrow="Avgiften framåt" titel={a.rubrik} lead={a.lead} />
      {a.tryck ? (
        <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
          <Pill ton={a.tryck.ton === "neutral" ? "neutral" : a.tryck.ton} label={a.tryck.etikett} />
          <Tag>Uppskattning</Tag>
        </View>
      ) : null}
      {a.osaker ? (
        <Callout variant="notice" titel="Osäker uppskattning">
          {a.osaker}
        </Callout>
      ) : null}

      <RantaBoxar a={a} />

      {d ? (
        <View style={{ marginTop: 12 }}>
          <Tabell
            kolumner={[
              { titel: "Det här driver den förväntade avgiften", flex: 3.2 },
              { titel: "Effekt på din avgift", flex: 1.1, hoger: true },
            ]}
            rader={d.rader.map((r, i) => ({
              key: `d-${i}`,
              celler: [
                <Namn
                  key="n"
                  label={r.label}
                  forklaring={r.forklaring}
                  {...(r.pageRef ? { sida: r.pageRef } : {})}
                />,
                <Text
                  key="v"
                  style={{
                    fontWeight: SEMI,
                    fontSize: 9.5,
                    color: r.dimmad ? PDF_COLORS.muted : TON_TEXT[r.ton],
                  }}
                >
                  {r.varde}
                </Text>,
              ],
            }))}
            foot={
              d.forvantad ? (
                <View style={[styles.tabellRad, { backgroundColor: PDF_COLORS.tint }]} wrap={false}>
                  <Text style={{ fontWeight: SEMI, fontSize: 9.5, color: PDF_COLORS.navy }}>
                    {d.forvantad}
                  </Text>
                </View>
              ) : null
            }
          />
          <Text style={[styles.small, { marginTop: 5 }]}>{d.energiText}</Text>
        </View>
      ) : null}

      {a.spar ? (
        <View style={{ marginTop: 14 }}>
          <View wrap={false} minPresenceAhead={130}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[styles.h3, { marginBottom: 0 }]}>{a.spar.rubrik}</Text>
              {a.spar.tryck ? <Pill ton={a.spar.tryck.ton} label={a.spar.tryck.etikett} /> : null}
            </View>
          </View>
          {a.spar.byggdelar.length > 0 ? (
            <>
              <Tabell
                kolumner={[
                  { titel: "Byggdel", flex: 2 },
                  { titel: "Senast åtgärdad", flex: 2.2 },
                  { titel: "Brukar hålla", flex: 1.1 },
                  { titel: "Läge", flex: 1.5 },
                ]}
                rader={a.spar.byggdelar.map((b, i) => ({
                  key: `b-${i}`,
                  celler: [
                    <Text key="l" style={[styles.cell, { fontWeight: SEMI }]}>
                      {b.label}
                    </Text>,
                    `${b.senast}${b.pageRef ? ` (${b.pageRef})` : ""}${b.forlangning ? `. ${b.forlangning}` : ""}`,
                    b.livslangd,
                    <Pill key="g" ton={b.lageTon} label={b.lage} />,
                  ],
                }))}
              />
              {a.spar.byggdelKalla ? (
                <Text style={[styles.small, { marginTop: 4 }]}>{a.spar.byggdelKalla}</Text>
              ) : null}
            </>
          ) : null}
          <View style={{ marginTop: 6 }}>
            <VardeLista
              rader={a.spar.rader.map((r) => ({
                label: r.label,
                note: r.note,
                varde: r.varde,
                undertext: undefined,
                total: r.total,
              }))}
            />
          </View>
          {a.spar.princip ? (
            <Text style={[styles.small, { marginTop: 4 }]}>{a.spar.princip}</Text>
          ) : null}
        </View>
      ) : null}

      {a.lan ? (
        <View style={{ marginTop: 14 }}>
          <View minPresenceAhead={110}>
            <Text style={styles.h3}>Föreningens lån</Text>
          </View>
          {a.lan.rader.length > 0 ? (
            <Tabell
              kolumner={[
                { titel: "Förfaller", flex: 1.4 },
                { titel: "Belopp", flex: 1.3 },
                { titel: "Ränta i årsredovisningen", flex: 1.4 },
                { titel: "Läge", flex: 2 },
              ]}
              rader={a.lan.rader.map((l, i) => ({
                key: `l-${i}`,
                celler: [
                  l.forfaller,
                  l.belopp,
                  l.ranta,
                  <Pill key="g" ton={l.lageTon} label={l.lage} />,
                ],
              }))}
            />
          ) : null}
          {a.lan.kalla ? <Text style={[styles.small, { marginTop: 4 }]}>{a.lan.kalla}</Text> : null}
          {a.lan.fastrad ? <Text style={styles.small}>{a.lan.fastrad}</Text> : null}
          {a.lan.refinansiering.length > 0 ? (
            <View style={{ marginTop: 4 }} wrap={false}>
              {a.lan.refinansiering.map((rad) => (
                <Text key={rad.label} style={{ fontSize: 8.5, color: PDF_COLORS.text2 }}>
                  <Text style={{ color: PDF_COLORS.muted }}>{rad.label}:</Text> {rad.value}
                </Text>
              ))}
            </View>
          ) : null}
          {a.lan.antagenAndel ? <Text style={styles.small}>{a.lan.antagenAndel}</Text> : null}
          {a.lan.forandring.length > 0 || a.lan.pageRef ? (
            <View style={{ marginTop: 6 }} wrap={false}>
              <VardeLista rader={a.lan.forandring} />
              {a.lan.pageRef ? (
                <Text style={[styles.sida, { marginTop: 3 }]}>{a.lan.pageRef}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ 4 Inför visningen + slut

function Fragor({ f }: { f: PdfFragor }) {
  return (
    <View style={styles.sektion}>
      <SektionsRubrik nummer="4" eyebrow="Inför visningen" titel={f.rubrik} lead={f.lead} />
      <View style={{ marginTop: 8 }}>
        {f.fragor.map((fr) => (
          <View key={fr.id} style={styles.fraga} wrap={false}>
            <View style={styles.checkbox} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: SEMI, fontSize: 10, lineHeight: 1.35 }}>{fr.fraga}</Text>
              <Text style={styles.body}>
                <Text style={{ fontWeight: SEMI }}>Varför: </Text>
                {fr.varfor}
              </Text>
              {fr.svarssignal?.typ === "tva" ? (
                <>
                  <Text style={styles.body}>
                    <Text style={{ fontWeight: SEMI }}>Bra svar: </Text>
                    {fr.svarssignal.bra}
                  </Text>
                  <Text style={styles.body}>
                    <Text style={{ fontWeight: SEMI }}>Varningssignal: </Text>
                    {fr.svarssignal.varning}
                  </Text>
                </>
              ) : fr.svarssignal ? (
                <Text style={styles.body}>{fr.svarssignal.text}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function Slut({ vm }: { vm: PdfViewModel }) {
  return (
    <View>
      <View style={[styles.card, { marginTop: 26 }]} wrap={false}>
        <Text style={styles.h3}>Källor och metod</Text>
        <Text style={styles.body}>{vm.kallor.intro}</Text>
        {vm.kallor.rader.map((r) => (
          <Text key={r} style={styles.punkt}>
            {"• "}
            {r}
          </Text>
        ))}
      </View>
      <Text style={[styles.small, { marginTop: 10 }]}>
        {vm.friskrivning}
        {vm.kontakt !== null ? ` Hittar du ett fel? Skriv till ${vm.kontakt}.` : ""}
      </Text>
    </View>
  );
}

/**
 * The full analysis as a printable A4 PDF, in the order and wording of the web report
 * (header, three summary cards, four numbered sections, sources, disclaimer). See
 * download.tsx for how it becomes a downloaded file.
 */
export function AnalysPdfDocument({
  analys,
  forsaljningar = null,
}: {
  analys: AnalysisResult;
  forsaljningar?: ForsaljningarSvar | null;
}) {
  const vm = buildPdfViewModel(analys, forsaljningar);
  return (
    <Document
      title={`Binfo-rapport — ${vm.foreningNamn}`}
      author="Binfo"
      subject="Bostadsrättsanalys"
      language="sv"
    >
      <Page size="A4" style={styles.page}>
        <Header foreningNamn={vm.foreningNamn} skapadLabel={vm.skapadLabel} />
        <Huvud vm={vm} />
        <Sammanfattningskort kort={vm.kort} />
        <Foreningen f={vm.foreningen} />
        <Priset p={vm.priset} />
        {vm.forsaljningar ? <Forsaljningar f={vm.forsaljningar} /> : null}
        <Avgiften a={vm.avgiften} />
        {vm.fragor ? <Fragor f={vm.fragor} /> : null}
        <Slut vm={vm} />
        <Footer kontakt={vm.kontakt} />
      </Page>
    </Document>
  );
}
