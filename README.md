# Binfo

Independent buyer-side decision support for Swedish bostadsrätter —
https://binfo.slanesens.com. Upload a BRF's årsredovisning and get the seven
statutory nyckeltal with flags, questions for the styrelse, a price check, a
bolånekalkyl and a köpguide.

The frontend is also edited in [Lovable](https://lovable.dev/projects/41bca6cf-bf55-4b1f-a422-89730ae592ae);
changes there are committed straight to `main`, so pull before working locally.

## Development

Requires Node 22 (see `.nvmrc`).

```sh
npm install
cp .env.example .env.local   # fill in values; never commit them
npm run dev                  # http://localhost:8080
npm test && npm run typecheck && npm run lint
```

Architecture, commands and conventions: see `CLAUDE.md`. Reference docs:
`SUPABASE.md` (backend and job orchestration), `PIPELINE.md` (analysis
pipeline), `BENCHMARKS.md` (nyckeltal thresholds).
