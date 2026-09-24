// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },

    // The Lovable wrapper sets importProtection.client.files to ["**/server/**"], which denies
    // any client-environment import whose RESOLVED path sits under a directory named `server`.
    // That rule is path-based, not content-based, so it also denies src/server/analysFn.ts —
    // even though that file is exactly the module the client is SUPPOSED to import. It holds
    // nothing but `createServerFn().handler()` wrappers, and Start's transform rewrites those
    // into RPC stubs that fetch /_serverFn/…; the handler bodies never enter the client graph.
    // Without this exclusion the build fails the moment a route wires up skapaAnalys/
    // hamtaStatus/hamtaResultat.
    //
    // Verified empirically before adding, with a throwaway route importing and calling
    // hamtaStatusFn: the production build succeeds, the route's client chunk is an 8 KB RPC
    // stub, and the client bundle contains zero occurrences of ANTHROPIC_API_KEY, sk-ant,
    // sb_secret, createClient, runExtraction, PROMPT_VERSION, skapaAnalys or anthropic.
    //
    // This exclusion names ONE file on purpose. Everything else under src/server/ stays denied
    // by the same guard, and the matching ESLint no-restricted-imports rule in eslint.config.js
    // keeps client code from reaching past analysFn in the editor as well. Do not widen this to
    // a directory pattern — that would silently re-admit the pipeline and the Supabase secret
    // key into the browser bundle.
    //
    // "**/node_modules/**" must be repeated: the plugin REPLACES excludeFiles with the value
    // given here rather than merging it with its own default, so omitting it would start
    // import-protecting third-party code.
    importProtection: {
      client: {
        excludeFiles: ["**/node_modules/**", "**/server/analysFn.ts"],
      },
    },
  },
});
