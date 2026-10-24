import { describe, expect, it } from "vitest";

import { kontrolleraAnnonsUrl } from "./url";

const ok = (typ: "bostad" | "annons", id: string) => ({
  ok: true,
  url: `https://www.booli.se/${typ}/${id}`,
  typ,
  id,
});
const fel = (errorCode: "fel_doman" | "ogiltig_url") => ({ ok: false, errorCode });

describe("kontrolleraAnnonsUrl: accepted", () => {
  const fall: [string, string, ReturnType<typeof ok>][] = [
    ["canonical bostad", "https://www.booli.se/bostad/719044", ok("bostad", "719044")],
    ["canonical annons", "https://www.booli.se/annons/6279984", ok("annons", "6279984")],
    [
      "query and fragment dropped",
      "https://www.booli.se/bostad/720821?utm=x#y",
      ok("bostad", "720821"),
    ],
    ["bare host", "https://booli.se/annons/6279984/", ok("annons", "6279984")],
    ["trailing slash", "https://www.booli.se/bostad/1/", ok("bostad", "1")],
    ["uppercase host", "HTTPS://WWW.BOOLI.SE/bostad/42", ok("bostad", "42")],
    ["mixed-case host", "https://Www.Booli.SE/bostad/42", ok("bostad", "42")],
    ["surrounding whitespace", "  https://www.booli.se/bostad/42\n", ok("bostad", "42")],
    ["scheme-less www", "www.booli.se/annons/123", ok("annons", "123")],
    ["scheme-less bare host", "booli.se/bostad/123?x=1", ok("bostad", "123")],
    ["scheme-less uppercase", "WWW.Booli.se/bostad/123", ok("bostad", "123")],
    ["12 digits", "https://www.booli.se/bostad/123456789012", ok("bostad", "123456789012")],
    [
      "explicit default port is normalised away by URL",
      "https://www.booli.se:443/bostad/5",
      ok("bostad", "5"),
    ],
  ];
  it.each(fall)("%s", (_namn, indata, forvantat) => {
    expect(kontrolleraAnnonsUrl(indata)).toEqual(forvantat);
  });
});

describe("kontrolleraAnnonsUrl: ogiltig_url (booli.se, but not a usable listing link)", () => {
  const fall: [string, string][] = [
    ["http", "http://www.booli.se/bostad/1"],
    ["http bare host", "http://booli.se/bostad/1"],
    ["explicit port", "https://www.booli.se:8443/bostad/1"],
    ["username", "https://user@www.booli.se/bostad/1"],
    ["username and password", "https://user:pw@www.booli.se/bostad/1"],
    ["search page", "https://www.booli.se/sok/till-salu"],
    ["non-numeric id", "https://www.booli.se/bostad/abc"],
    ["id with letters", "https://www.booli.se/bostad/123abc"],
    ["13 digits", "https://www.booli.se/bostad/1234567890123"],
    ["missing id", "https://www.booli.se/bostad/"],
    ["no path", "https://www.booli.se"],
    ["root", "https://www.booli.se/"],
    ["other section", "https://www.booli.se/bostadsrattsforening/48585"],
    ["extra path segment", "https://www.booli.se/bostad/1/extra"],
    ["sold page", "https://www.booli.se/slutpriser/stockholm"],
    ["double slash", "https://www.booli.se//bostad/1"],
    ["negative id", "https://www.booli.se/bostad/-1"],
    ["encoded slash", "https://www.booli.se/bostad%2F1"],
    ["non-http scheme on booli host", "ftp://www.booli.se/bostad/1"],
  ];
  it.each(fall)("%s", (_namn, indata) => {
    expect(kontrolleraAnnonsUrl(indata)).toEqual(fel("ogiltig_url"));
  });
});

describe("kontrolleraAnnonsUrl: fel_doman (not booli.se at all)", () => {
  const fall: [string, string][] = [
    ["suffix attack", "https://www.booli.se.evil.com/bostad/1"],
    ["prefix attack", "https://evilbooli.se/bostad/1"],
    ["dash prefix", "https://www-booli.se/bostad/1"],
    ["userinfo disguise", "https://www.booli.se@evil.com/bostad/1"],
    ["backslash disguise", "https://evil.com\\@www.booli.se/bostad/1"],
    ["mobile subdomain is not accepted", "https://m.booli.se/bostad/1"],
    ["other subdomain", "https://api.booli.se/bostad/1"],
    ["trailing dot host", "https://www.booli.se./bostad/1"],
    ["other portal", "https://hemnet.se/bostad/1"],
    ["other portal with www", "https://www.hemnet.se/bostad/1"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["file scheme", "file:///etc/passwd"],
    ["empty", ""],
    ["whitespace only", "   "],
    ["plain text", "Sandelsgatan 35"],
    ["text with spaces around a link", "kolla https://www.booli.se/bostad/1 nu"],
    ["internal newline", "https://www.booli.se/bos\ntad/1"],
    ["scheme-less other host", "evil.com/bostad/1"],
    ["scheme-less lookalike", "www.booli.se.evil.com/bostad/1"],
    ["IPv4", "https://127.0.0.1/bostad/1"],
    ["IPv4 with port", "https://10.0.0.1:8080/bostad/1"],
    ["IPv4 as decimal", "https://2130706433/bostad/1"],
    ["IPv6", "https://[::1]/bostad/1"],
    ["localhost", "http://localhost/bostad/1"],
    ["longer than any link", `https://www.booli.se/bostad/1?${"a".repeat(3000)}`],
  ];
  it.each(fall)("%s", (_namn, indata) => {
    expect(kontrolleraAnnonsUrl(indata)).toEqual(fel("fel_doman"));
  });

  it("non-string input does not throw", () => {
    expect(kontrolleraAnnonsUrl(undefined as unknown as string)).toEqual(fel("fel_doman"));
    expect(kontrolleraAnnonsUrl(null as unknown as string)).toEqual(fel("fel_doman"));
    expect(kontrolleraAnnonsUrl(42 as unknown as string)).toEqual(fel("fel_doman"));
  });
});

describe("kontrolleraAnnonsUrl: canonical form is the cache key", () => {
  it("different spellings of one listing give one URL", () => {
    const former = [
      "https://www.booli.se/bostad/720821",
      "https://booli.se/bostad/720821/",
      "https://www.booli.se/bostad/720821?utm_source=a",
      "https://WWW.BOOLI.SE/bostad/720821#kartan",
      "www.booli.se/bostad/720821",
    ];
    const urler = new Set(former.map((f) => (kontrolleraAnnonsUrl(f) as { url: string }).url));
    expect([...urler]).toEqual(["https://www.booli.se/bostad/720821"]);
  });
});
