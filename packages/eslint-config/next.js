import { globalIgnores } from 'eslint/config';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import pluginNext from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';

import { config as baseConfig } from './base.js';

export const nextJsConfig = [
  ...baseConfig,

  // Enable TypeScript and TSX linting.
  ...tseslint.configs.recommended,

  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),

  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
    plugins: {
      '@next/next': pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs['core-web-vitals'].rules,
    },
  },

  pluginReactHooks.configs.flat.recommended,
];
