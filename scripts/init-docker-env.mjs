import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

for (const [environment, port] of [
  ['dev', 3000],
  ['prod', 8080],
]) {
  const prefix = environment.toUpperCase();
  const filename = `.env.${environment}`;
  const path = fileURLToPath(new URL(`../${filename}`, import.meta.url));
  const password = () => randomBytes(32).toString('hex');
  const content = [
    '# Local credentials. Never commit, share, or bake this file into an image.',
    `${prefix}_POSTGRES_ADMIN_PASSWORD=${password()}`,
    `${prefix}_POSTGRES_APP_PASSWORD=${password()}`,
    `${prefix}_REDIS_PASSWORD=${password()}`,
    `${prefix}_CORS_ORIGINS=http://localhost:${port},http://127.0.0.1:${port}`,
    '',
  ].join('\n');

  try {
    writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
    console.log(`Created ${filename} with unique credentials.`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log(`Kept existing ${filename}; credentials were not rotated.`);
  }
}
