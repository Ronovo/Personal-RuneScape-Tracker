// Type-aware linting for the rules tsc can't express.
//
// The three tsc flags in tsconfig.base.json (noUnusedLocals,
// noUnusedParameters, noUncheckedIndexedAccess) already cover dead code and
// unchecked indexing, so this deliberately stays narrow: the rules below are
// the ones that caught real defects, not a style opinion. Formatting is not
// linted - there is no formatter here on purpose.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // public/ holds the compiled browser bundle (client/ and shared/).
  { ignores: ['dist/**', 'public/**/*.js', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Both builds, so client and server files are each linted with the
        // types they are actually compiled against.
        project: ['./tsconfig.server.json', './tsconfig.client.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The one this was added for: an unawaited promise in a page script is
      // a dropped error, and flip.ts had eight of them sitting next to call
      // sites that did spell out `void`.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // The codebase reads untrusted JSON constantly and narrows it by hand;
      // that is the pattern, not a mistake to flag on every line.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      // tsc's noUnusedLocals already reports these, with better placement.
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      // Non-null assertions are how this codebase states "the markup
      // guarantees this element"; noUncheckedIndexedAccess makes them mean
      // something rather than being no-ops.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // This config itself, and any other loose ESM at the root, is outside both
    // tsconfigs and has no program to type-check against.
    files: ['*.mjs'],
    languageOptions: { parserOptions: { project: null, projectService: false } },
    rules: { ...tseslint.configs.disableTypeChecked.rules },
  },
  {
    // node:test owns the promise `test()` returns - it awaits the suite itself,
    // and the whole file is written that way. Flagging 180 of those would bury
    // the handful of real ones in src/.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    // Scripts are plain ESM run by node, outside either tsconfig, so the
    // type-aware rules have no program to consult. Their `rules` have to be
    // merged in rather than replaced, or the disable does nothing.
    files: ['scripts/**/*.mjs'],
    languageOptions: { parserOptions: { project: null, projectService: false } },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      // `process`, `console` and friends, without pulling in a globals package.
      'no-undef': 'off',
    },
  },
);
