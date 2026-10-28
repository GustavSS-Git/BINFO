/**
 * Who runs Binfo and how to reach them. Used by the privacy page and the
 * "Hittar du ett fel?" line on the public BRF pages. Owner-supplied values
 * only: never guess an address here.
 */

/** Personuppgiftsansvarig (GDPR controller). */
export const PERSONUPPGIFTSANSVARIG = "Binfo (binfo.slanesens.com)";

/** Contact address for privacy requests and corrections (owner 2026-10-28). `null` hides the
 *  footer "Kontakt" and "Hittar du ett fel?" links. */
export const KONTAKT_EPOST: string | null = "contactbinfohere@gmail.com";
