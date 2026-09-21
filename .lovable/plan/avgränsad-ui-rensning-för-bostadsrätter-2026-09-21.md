# Avgränsad UI-rensning för bostadsrätter

## Mål
Ta bort de fem angivna elementen från gränssnittet utan redesign och utan att ändra analyskontraktet eller bakomliggande beräkningsfunktioner.

## Ändringar
- På **Analysera** tas valet mellan Bostadsrätt och Hus bort. Sidan skickar fortsatt bostadsrätt, medan befintligt stöd för hus lämnas kvar i övrig kod och på andra sidor.
- **Andelstal** tas bort från formuläret och objektsammanfattningen. Det interna kompatibilitetsvärdet blir `0`.
- **Föreningens organisationsnummer** tas bort från formuläret. Det interna kompatibilitetsvärdet blir tom text.
- Dold validering för andelstal och organisationsnummer tas bort så att formuläret fortfarande kan skickas.
- **Försäljningar i föreningen** tas bort från den gemensamma rapportvisningen, vilket gäller både exempelrapporten och riktiga analyser. Data och analysfunktioner lämnas kvar.
- **Antal personer i hushållet** tas endast bort från Analysera. Fältet, delad state och vattenschablonen i Bolånekalkyl lämnas orörda.

## Teknisk avgränsning
- `PropertyInput` och analysresultatets kontrakt ändras inte.
- Prisdata, husstöd och andra bakomliggande funktioner tas inte bort.
- Ingen typografi, färg, layoutstil eller annan text ändras.

## Kontroll
- Uppdatera formulärtesterna först så att de nya kompatibilitetsvärdena och den icke-blockerande valideringen verifieras.
- Kör projektets typkontroll och hela testsvit.
- Kontrollera visuellt att Analysera, exempelrapporten och en analysrapport saknar endast de angivna elementen, samt att Bolånekalkyl fortfarande visar hushållsstorlek.
