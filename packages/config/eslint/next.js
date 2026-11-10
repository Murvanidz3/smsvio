import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

import { ignores, typescriptRules } from './base.js';

/**
 * ESLint config for the Next.js web app.
 * @param {{ tsconfigRootDir: string }} options
 */
export function nextConfig({ tsconfigRootDir }) {
  return defineConfig(
    ignores,
    nextCoreWebVitals,
    nextTypescript,
    typescriptRules({ tsconfigRootDir }),
    { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
    prettier,
  );
}
