/**
 * Re-fetch the Booli fixture pages and run the parser on them, to spot Booli
 * layout changes (docs/booli.md).
 *
 *   node --import tsx scripts/hamtaBooliFixtures.ts           # fetch + report, writes nothing
 *   node --import tsx scripts/hamtaBooliFixtures.ts --spara   # also overwrite fixtures/booli/<typ>-<id>.html
 *
 * URLs come from fixtures/booli/booli_links.txt (one per line, `#` comments).
 * Each URL is fetched ONCE, with curl and a normal browser header set: Booli's
 * Cloudflare challenges Node's TLS fingerprint (undici `fetch`), see
 * docs/booli.md. A challenge is reported, never worked around. A page that is
 * not `ok` (challenge, error status, parse failure) is never saved over a
 * fixture, even with --spara.
 *
 * Run it rarely and by hand (6 requests). Not part of the test suite.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ANNONS_FALT } from "../src/lib/annons/typer";
import { kontrolleraAnnonsUrl } from "../src/lib/annons/url";
import { tolkaBooli } from "../src/server/annons/booli";

const FIXTURER = join(process.cwd(), "fixtures", "booli");
const MAX_BYTES = 8 * 1024 * 1024;
const SPARA = process.argv.includes("--spara");

/**
 * The browser header set that gets a real page from Booli (docs/booli.md).
 * Cloudflare reacts to the header set and its order, not only the values: this
 * order (User-Agent via -A, then Accept*, Sec-Fetch-*, sec-ch-ua*) returned 200
 * on 2026-10-24 while an order with sec-ch-ua* right after Accept-Encoding was
 * challenged. Keep it unless a run says otherwise.
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const HUVUDEN: readonly string[] = [
  "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language: sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding: gzip, deflate, br",
  "Sec-Fetch-Dest: document",
  "Sec-Fetch-Mode: navigate",
  "Sec-Fetch-Site: none",
  "Sec-Fetch-User: ?1",
  "Upgrade-Insecure-Requests: 1",
  'sec-ch-ua: "Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  "sec-ch-ua-mobile: ?0",
  'sec-ch-ua-platform: "macOS"',
];

interface Hamtat {
  status: number;
  html: string;
}

function hamta(url: string): Hamtat {
  const args = [
    "--silent",
    "--show-error",
    "--compressed",
    "--location",
    "--max-redirs",
    "3",
    "-A",
    USER_AGENT,
    "--max-time",
    "30",
    "--max-filesize",
    String(MAX_BYTES),
    ...HUVUDEN.flatMap((h) => ["-H", h]),
    "--write-out",
    "\n%{http_code}",
    url,
  ];
  const ut = execFileSync("curl", args, { encoding: "utf8", maxBuffer: MAX_BYTES + 1024 });
  const i = ut.lastIndexOf("\n");
  return { status: Number(ut.slice(i + 1)), html: ut.slice(0, i) };
}

function lasLankar(): string[] {
  return readFileSync(join(FIXTURER, "booli_links.txt"), "utf8")
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r !== "" && !r.startsWith("#"));
}

function main(): void {
  const lankar = lasLankar();
  console.log(
    `${lankar.length} URLs from fixtures/booli/booli_links.txt, ${SPARA ? "--spara: fixtures are overwritten" : "dry run (add --spara to overwrite fixtures)"}`,
  );
  let allaOk = true;

  for (const rad of lankar) {
    const kontroll = kontrolleraAnnonsUrl(rad);
    if (!kontroll.ok) {
      console.log(`${rad}  SKIPPAD (${kontroll.errorCode})`);
      allaOk = false;
      continue;
    }
    const fil = `${kontroll.typ}-${kontroll.id}.html`;
    let hamtat: Hamtat;
    try {
      hamtat = hamta(kontroll.url);
    } catch (e) {
      console.log(
        `${kontroll.url}  NATVERKSFEL ${e instanceof Error ? e.message.split("\n")[0] : e}`,
      );
      allaOk = false;
      continue;
    }

    const tolkning = tolkaBooli(hamtat.html, kontroll.url);
    const stor = `${Math.round(hamtat.html.length / 1024)} kB`;
    if (tolkning.typ !== "ok") {
      allaOk = false;
      const extra = tolkning.typ === "tolkning_misslyckad" ? ` (${tolkning.orsak})` : "";
      console.log(
        `${kontroll.url}  HTTP ${hamtat.status}  ${stor}  ${tolkning.typ.toUpperCase()}${extra}  [sparas inte]`,
      );
      continue;
    }
    const faltText = ANNONS_FALT.map(
      (f) => `${f}=${tolkning.uppgifter[f] === undefined ? "SAKNAS" : "ok"}`,
    ).join(" ");
    const tillagg = (["stadsdel", "forening", "maklarUrl", "koordinater"] as const)
      .map((f) => `${f}=${tolkning.uppgifter[f] === undefined ? "SAKNAS" : "ok"}`)
      .join(" ");
    let sparat = "";
    if (SPARA) {
      writeFileSync(join(FIXTURER, fil), hamtat.html);
      sparat = `  sparad som ${fil}`;
    }
    console.log(
      `${kontroll.url}  HTTP ${hamtat.status}  ${stor}  OK  ${faltText} | ${tillagg}${sparat}`,
    );
  }

  if (!allaOk) process.exitCode = 1;
}

main();
