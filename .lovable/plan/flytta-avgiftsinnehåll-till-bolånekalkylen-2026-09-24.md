# Flytta avgiftsinnehåll till bolånekalkylen

## Ändringar
- Ta bort det synliga blocket ”Vad ingår i avgiften?” från sidan Analysera.
- Behåll underliggande fält och dataflöde oförändrade så analyskontraktet inte påverkas.
- Lägg samma fem trelägesval i en kompakt, infällbar sektion direkt efter fältet Månadsavgift på Bolånekalkyl.
- Låt valen fortsätta styra schablonerna och kostnadsspannet i kalkylen.

## Teknisk avgränsning
- Endast de två berörda sidornas presentation och befintliga delade state ändras.
- Inga beräkningsregler, analystyper eller andra sidor ändras.

## Verifiering
- Kontrollera att blocket är borta på Analysera.
- Kontrollera att menyn öppnas på Bolånekalkyl och att valen uppdaterar kostnaderna.
- Kör typkontroll och tester.
