// @ts-check
import eslint from "@eslint/js";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/node_modules/", "**/dist/", "**/.next/", "**/coverage/", "**/next-env.d.ts"]),

  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // NestJS modules are intentionally empty classes configured through decorators.
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
      // Data shapes are modelled as type aliases (no accidental declaration merging).
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    },
  },

  {
    files: ["apps/web/**"],
    extends: [nextCoreWebVitals],
    settings: { next: { rootDir: "apps/web" } },
    languageOptions: { globals: globals.browser },
  },

  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Must stay last: turns off stylistic rules that conflict with Prettier.
  prettier,
]);
