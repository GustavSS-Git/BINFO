/**
 * /sitemap.xml: pure builder, client-safe. The server route
 * (src/routes/sitemap[.]xml.tsx) feeds it the register posts from
 * `hamtaSitemapDataFn`.
 *
 * Only indexable public pages are listed. The private ones (/analys,
 * /forhandsvisning, /konto) are `noindex` and never appear here.
 */
import { SITE_URL, type RegisterSitemapPost } from "@/lib/registerVy";

/** Static, indexable pages (the register's own pages come from the database). */
export const STATISKA_SIDOR: readonly string[] = [
  "/",
  "/analysera",
  "/bolanekalkyl",
  "/kopguide",
  "/exempel",
  "/om-oss",
];

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `YYYY-MM-DD` (W3C date) from an ISO timestamp, or null when it does not parse. */
export function lastmodDatum(iso: string | null): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function byggSitemapXml(register: readonly RegisterSitemapPost[]): string {
  const poster: RegisterSitemapPost[] = [
    ...STATISKA_SIDOR.map((path) => ({ path, lastmod: null })),
    ...register,
  ];
  const sedda = new Set<string>();
  const rader: string[] = [];
  for (const p of poster) {
    if (sedda.has(p.path)) continue;
    sedda.add(p.path);
    const lastmod = lastmodDatum(p.lastmod);
    rader.push(
      `  <url><loc>${xmlEscape(`${SITE_URL}${p.path}`)}</loc>${
        lastmod ? `<lastmod>${lastmod}</lastmod>` : ""
      }</url>`,
    );
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rader.join("\n")}\n</urlset>\n`
  );
}
