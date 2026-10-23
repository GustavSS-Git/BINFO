import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseSparaSok } from "@/lib/till";

// The standalone price check ("Bara priskoll") was merged into /analysera as
// step 1 (2026-10-23). Keeps old links, saved-valuation links
// (`?sparad=<id>`), pending post-login saves (`?spara=`) and search-engine
// entries working with a permanent redirect.
export const Route = createFileRoute("/vardering")({
  validateSearch: parseSparaSok,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/analysera", search, statusCode: 301 });
  },
});
