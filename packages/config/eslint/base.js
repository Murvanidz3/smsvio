import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const ignores = {
  ignores: [
    '**/dist/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/src/generated/**',
    '**/next-env.d.ts',
    '**/playwright-report/**',
    '**/test-results/**',
  ],
};

/**
 * Type-aware rules shared by every TypeScript package.
 * @param {{ tsconfigRootDir: string }} options
 */
export function typescriptRules({ tsconfigRootDir }) {
  return defineConfig(
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      rules: {
        eqeqeq: ['error', 'always'],
        'no-console': 'error',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': 'allow-with-description' },
        ],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [tseslint.configs.disableTypeChecked],
    },
  );
}

/**
 * ESLint config for plain Node.js TypeScript packages.
 * @param {{ tsconfigRootDir: string }} options
 */
export function nodeConfig({ tsconfigRootDir }) {
  return defineConfig(
    ignores,
    typescriptRules({ tsconfigRootDir }),
    { languageOptions: { globals: { ...globals.node } } },
    prettier,
  );
}
