import pluginReactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { config as baseConfig } from './base.js';

export const config = [
  ...baseConfig,

  // TypeScript and TSX support
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },

  pluginReactHooks.configs.flat.recommended,
];
