const eslintCommand = (workspace, files) => {
  const paths = files.map((file) => `"${file.replaceAll('\\', '/')}"`).join(' ');

  return `pnpm --filter ${workspace} exec eslint --fix --max-warnings 0 ${paths}`;
};

export default {
  'apps/web/**/*.{js,jsx,ts,tsx}': (files) => eslintCommand('web', files),

  'apps/api/{src,test}/**/*.{ts,tsx}': (files) => eslintCommand('api', files),

  'packages/ui/**/*.{js,jsx,ts,tsx}': (files) => eslintCommand('@repo/ui', files),

  '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,json,md,mdx,yaml,yml,css,scss,html}':
    'pnpm exec prettier --write',
};
