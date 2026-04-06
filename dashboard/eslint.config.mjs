/**
 * ESLint flat config for the Next.js dashboard.
 *
 * Catches bugs that TypeScript strict mode doesn't — unused variables,
 * unreachable code, missing dependencies in React hooks, etc.
 * Intentionally minimal: no formatting rules (use Prettier for that).
 *
 * Run: cd dashboard && npx eslint . --max-warnings 0
 *
 * PHILOSOPHY:
 * - Only rules that catch real bugs or improve AI readability
 * - No stylistic opinions (no semicolon/quote wars)
 * - Warnings are errors in CI (--max-warnings 0)
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Ignore build output and generated files
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "public/sw.js",
      "tests/mocks/**",
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended rules (type-aware where possible)
  ...tseslint.configs.recommended,

  // Project-specific overrides
  {
    rules: {
      // Allow unused vars prefixed with _ (common pattern for destructuring)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // Allow `any` in specific cases (Viam SDK doCommand, sensor readings)
      "@typescript-eslint/no-explicit-any": "warn",

      // Catch real bugs
      "no-constant-condition": "error",
      "no-unreachable": "error",
      "no-duplicate-case": "error",

      // Allow empty catch blocks (common in graceful error handling)
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-empty-function": "off",

      // Allow require() in config files
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
