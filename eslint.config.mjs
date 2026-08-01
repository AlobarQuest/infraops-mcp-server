// code-standards:managed:start — everything down to :end is replaced by `code-standards sync`.
// @ts-check
// DEPENDENCY NOTE: This config requires `eslint` and `typescript-eslint` as devDependencies.
// Install with: npm i -D eslint typescript-eslint
// If either package is missing, ESLint will fail with a config-load error.
// That error surfaces in code-standards as a "tool errors (gate incomplete)" WARN
// (exit 0, but logged to the audit file) — not a silent pass.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores: never lint generated trees. Without this, `eslint .` /
  // `next lint` drown in generated output (agent-sites: 5188 problems from .next).
  // A config object with ONLY `ignores` is treated by ESLint as global ignores.
  // `next-env.d.ts` is regenerated on every Next.js build with a triple-slash
  // reference that trips @typescript-eslint/triple-slash-reference, and is not
  // hand-editable — never lint it (agent-sites).
  {
    ignores: ['.next/', 'dist/', 'build/', 'node_modules/', 'next-env.d.ts'],
  },
  ...tseslint.configs.recommended,
  // Treat `_`-prefixed bindings as the intentional "unused" marker (the
  // near-universal convention) so real source like `_pageType`/`_siteId`/`_`
  // isn't flagged by no-unused-vars (agent-sites).
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
// code-standards:managed:end — content OUTSIDE these markers is yours and is preserved. Append your own config objects BELOW this line and ABOVE the closing paren: ESLint flat config is last-wins, so they override what the block sets. Delete both markers to own the whole file: sync then writes nothing here and says so every run.

  // ---- LOCAL — owned by this repo, appended so it survives `code-standards sync`.
  // ESLint flat config is last-wins, so every object below overrides the block above.

  // `.worktrees/` holds git worktree checkouts of this same repo; linting them
  // double-reports every finding. Global `ignores` objects accumulate, so this
  // adds to the managed list rather than replacing it.
  {
    ignores: ['.worktrees/'],
  },
  {
    rules: {
      // Provider SDK responses and MCP tool adapters intentionally cross
      // dynamic JSON boundaries. TypeScript still checks the surrounding
      // contracts; forcing decorative `unknown as ...` casts here reduces
      // clarity without adding runtime validation.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
);
