# Binfo Trygg Bostad

Build a web application called Binfo — an independent, buyer-side decision tool for people buying a home in Sweden, focused on bostadsrätter (housing-cooperative apartments) but also supporting houses (villor/fastigheter). Binfo helps a buyer understand the true risk and fair price of a specific property before they bid, and guides them through the entire buying and mortgage process.

This first prompt is the foundation: set up the full project structure, design system, navigation, data model, and all screens as working shells with realistic Swedish demo data. I will refine individual screens in later prompts. Prioritize a clean, coherent foundation over feature completeness.

Tech & setup

React + TypeScript + Tailwind. Use React state only (no backend yet — this is a frontend prototype with mock data).

Create a single mock-data file (mockData.ts) holding one fully worked example property so every screen reads from the same source. Use a fictional "Brf Lindgården", Södermalm, Stockholm: utgångspris 4 950 000 kr, 58 m², 3:a, våning 4 av 6, månadsavgift 3 240 kr, skuldsättning ~8 500 kr/m², byggår 1931, andelstal 2,1%. Keep all numbers internally consistent.

All UI text in Swedish, natural and idiomatic.

Mobile-responsive, designed desktop-first.

Design system

Calm, trustworthy Nordic-fintech aesthetic. This tool handles the biggest purchase of someone's life — it must feel dependable, not flashy.

One accent color: deep teal (#0E6E82). Neutral ink (#16202E) for text, soft grays for borders and muted text. Generous whitespace, rounded cards (subtle border, minimal shadow), clear type hierarchy.

Define this as reusable Tailwind theme tokens and shared components (Card, Button, StatusDot, Badge) so the whole app is consistent.

Navigation

Persistent top nav with the Binfo wordmark and links to: Hem, Analysera, Guide, Bolånekalkyl. The report screens are reached through the Analysera flow. Make everything clickable and navigable.

Screens

1. Hem (landing)

Headline conveying the core promise: existing tools grade the building — Binfo helps you decide on the deal.

Subhead: en oberoende risk- och priskontroll för bostaden du är på väg att buda på.

Primary CTA "Analysera en bostad". Trust row: "Oberoende · Inte kopplad till mäklare eller bank."

A 3-step strip: Ladda upp årsredovisning → Få din analys → Fatta beslut.

2. Analysera (upload)

A toggle at the top: Bostadsrätt / Hus (this choice affects later screens — e.g. houses show lagfart/pantbrev, apartments don't).

Drag-and-drop zone for the annual report PDF (visual only).

Form: utgångspris, boarea, våning, månadsavgift, andelstal.

"Analysera"-knapp → navigates to the preview.

3. Förhandsvisning (free preview — the conversion screen)

Overall risk grade in a circular badge (e.g. "B+"), and TWO red flags fully visible.

3–4 further insight cards visually blurred with a lock icon.

Paywall card: "Lås upp hela analysen — 249 kr" with a button that navigates to the full report (simulate payment).

4. Fullständig analys (full report) — core screen, rich, stacked cards:

Föreningens ekonomi: the 7 statutory key figures, each with value, colored status dot (green/amber/red), and a one-line plain-language explanation. Highlight skuldsättning per m².

Är priset rimligt? Compare Utgångspris vs Boolis värdering vs senaste försäljning i samma förening, with clear % differences and a short verdict sentence.

Vad händer om räntan stiger? An interactive slider (0 to +3 percentage points) that live-updates this apartment's monthly fee; show dagens avgift vs stressad avgift side by side.

Frågor att ställa: checklist of 5–6 specific, realistic Swedish questions for the board and agent, tied to the maintenance plan, loan terms, and planned fee changes.

"Ladda ner som PDF"-knapp (non-functional placeholder).

5. Bolånekalkyl (total cost calculator) — make this genuinely interactive:

Inputs: lånebelopp, ränta %, kontantinsats, hushållets bruttoinkomst/år. Pulls in this property's månadsavgift automatically.

Output: total månadskostnad = räntekostnad + amortering + avgift, shown as one large number, with each component on its own line.

Implement Swedish amorteringskrav correctly: 2%/år if belåningsgrad > 70%, 1%/år if 50–70%, 0% below 50%, PLUS an additional 1%/år if the loan exceeds 4,5× hushållets bruttoårsinkomst. Show belåningsgrad and the applied amortization rate explicitly.

Include the same rate-stress toggle so ränta and total cost move together.

6. Guide (buying-process timeline) — build this one out fully now, it's a priority.

Create an interactive vertical timeline of the complete Swedish home-buying process. Each step is a clickable node; clicking (or expanding) a step reveals a detail panel with: a short description, viktiga flaggor (warnings, in a colored callout), and tips (in a separate callout). Steps start collapsed showing just title + one-line summary; expanding shows the full detail. Include a progress indicator so the user can see where they are.

Include all these steps in order:

Förberedelse & lånelöfte — get a mortgage promise before viewing. Flag: lånelöfte is not a guarantee; it can be withdrawn. Tip: get it from more than one bank to compare.

Sök & bevaka objekt — Hemnet/Booli, set up bevakningar.

Visning — what to inspect. Flag: agent represents the seller. Tip: bring the checklist from your Binfo report; check ventilation, water pressure, damp.

Granska föreningens ekonomi — read the årsredovisning (this is where Binfo plugs in). Flag: high skuldsättning + low rate = future fee hikes. Tip: run the property through Binfo before bidding.

Budgivning — how open bidding works. Flag: budgivning is not legally binding and bud can be fabricated pressure; set a walk-away number in advance. Tip: bid on the total monthly cost you can carry, not the headline price.

Vinnande bud & överenskommelse — accepted bid is not binding until contract.

Kontrakt (upplåtelseavtal/köpekontrakt) — signing. Flag: read the clauses and any friskrivning carefully. Tip: this is the point it becomes binding — be sure before you sign.

Handpenning — normally ~10% of the price, paid to the agent's klientmedelskonto a few days after contract. Flag: this is real money at risk if you default — make sure financing is secured before you sign the contract, not after.

Ansök om bolån & bind/rörlig ränta — finalize the mortgage. Flag: your final rate may differ from the lånelöfte. Tip: decide bunden vs rörlig ränta; compare the offer against another bank.

Medlemskap i föreningen (bostadsrätt only) — the board must approve you as a member. Flag: approval can be refused; don't give notice on your current home until approved.

Tillträde & slutbetalning — the remaining ~90% is paid, keys handed over. For houses: register lagfart and pantbrev here (show these steps only when "Hus" is selected). Tip: do a final inspection before you pay.

Efter tillträde — insurance active from tillträde, deklaration/vinstskatt implications later.

Make the "Hus"/"Bostadsrätt" toggle from the Analysera screen affect which steps and costs show (e.g. medlemskap only for bostadsrätt; lagfart/pantbrev only for hus).

After this foundation

Leave clear component boundaries so I can later refine each screen individually. Add brief code comments marking where the real analysis pipeline and payment integration will connect.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/41bca6cf-bf55-4b1f-a422-89730ae592ae).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
