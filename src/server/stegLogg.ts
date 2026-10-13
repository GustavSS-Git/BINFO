/**
 * Skriver det underliggande felet till serverloggen (Edge-loggen) när ett steg
 * misslyckas: felklass, HTTP-status om det finns, och meddelandet. Köparen ser
 * bara den säkra texten från tolkaFel ("unknown" döljer annars orsaken helt —
 * ett utgånget Anthropic-nyckel gav bara 'unknown' utan spår i loggen). Inga
 * hemligheter: Anthropic-SDK:ts felmeddelanden innehåller aldrig API-nyckeln,
 * men allt som ser ut som en nyckel maskas ändå.
 */
export function loggaStegfel(plats: string, errorCode: string, error: unknown): void {
  const namn = error instanceof Error ? error.name : typeof error;
  const status = (error as { status?: unknown } | null)?.status;
  const text = error instanceof Error ? error.message : String(error);
  const maskad = text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***").slice(0, 1000);
  console.error(
    `[steg-fel] ${plats}: ${errorCode} — ${namn}${typeof status === "number" ? ` (HTTP ${status})` : ""}: ${maskad}`,
  );
}
