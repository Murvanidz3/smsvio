import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

import { ignores, typescriptRules } from './base.js';

/**
 * ESLint config for NestJS applications and libraries.
 * @param {{ tsconfigRootDir: string }} options
 */
export function nestConfig({ tsconfigRootDir }) {
  return defineConfig(
    ignores,
    typescriptRules({ tsconfigRootDir }),
    {
      languageOptions: {
        globals: { ...globals.node },
        parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
      },
      rules: {
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      },
    },
    prettier,
  );
}
