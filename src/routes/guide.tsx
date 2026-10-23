import { createFileRoute, redirect } from "@tanstack/react-router";

// The buying guide moved to /kopguide (2026-10-23). Keeps old links and
// search-engine entries working with a permanent redirect.
export const Route = createFileRoute("/guide")({
  beforeLoad: () => {
    throw redirect({ to: "/kopguide", statusCode: 301 });
  },
});
