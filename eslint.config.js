import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", "supabase/functions/**", "ml/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: [
      "src/routes/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/data/**/*.{ts,tsx}",
      "src/lib/analysisView.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/server",
              message:
                "Client code may only reach src/server/ through @/server/analysFn's createServerFn wrappers, not a barrel import of the server root.",
            },
          ],
          patterns: [
            {
              // "@/server/**" (not the bare "@/server") is required for the
              // "!@/server/analysFn" negation below to take effect: the `ignore`
              // package underlying this option follows gitignore semantics,
              // where a matched directory-like pattern (e.g. bare "@/server")
              // blocks recursion into it entirely, so no later negation pattern
              // for a path "inside" it — including "@/server/analysFn" — can
              // ever re-include it. Verified empirically; see task notes.
              group: [
                "@/server/**",
                "!@/server/analysFn",
                "@/lib/analysis/runExtraction",
                "@/lib/analysis/analyze",
                "@/lib/analysis/pdf",
                "@/lib/analysis/extract",
                "@/lib/analysis/prompts",
                "@/lib/analysis/assemble",
                "@/lib/analysis/costGuard",
                "@/lib/analysis/prisdata",
                "@/lib/analysis/schema",
                "@/lib/analysis/cli",
                "@/lib/analysis/answerKey",
                "@/lib/analysis/verifyAnswerKey",
                "@/lib/vardering",
                "@/lib/vardering/**",
              ],
              message:
                "Client code may only reach src/server/ through @/server/analysFn's createServerFn wrappers — everything else in src/server/ does server-side work or holds secrets. Client code may also only import the pure src/lib/analysis/calc/* modules and benchmarks.ts; the rest of the analysis pipeline and the valuation model (@/lib/vardering) listed here must never reach the browser bundle.",
            },
          ],
        },
      ],
    },
  },
  eslintPluginPrettier,
);
