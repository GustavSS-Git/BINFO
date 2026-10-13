/**
 * Who runs Binfo and how to reach them. Used by the privacy page and the
 * "Hittar du ett fel?" line on the public BRF pages. Owner-supplied values
 * only: never guess an address here.
 */

/** Personuppgiftsansvarig (GDPR controller). */
export const PERSONUPPGIFTSANSVARIG = "Gustav Slåne Sens";

/** Contact address for privacy requests and corrections. `null` until the
 *  owner supplies one; the pages then show a text without a link. */
export const KONTAKT_EPOST: string | null = null;
