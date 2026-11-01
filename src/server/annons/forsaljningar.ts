/**
 * Earlier sales of one flat (docs/plans/salt-i-huset.md). STUB: the server
 * agent replaces the body; the signature is the shared seam.
 */

import type { ForsaljningarSvar } from "@/lib/annons/forsaljningar";
import type { HamtaAnnonsBeroenden } from "./kallor";

export async function hamtaForsaljningar(
  _data: unknown,
  _beroenden: HamtaAnnonsBeroenden,
): Promise<ForsaljningarSvar> {
  return { ok: false };
}
