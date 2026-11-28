import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, lstatSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ZipArchive } from 'archiver';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exportDirectory = join(root, 'exports');

const excludedDirectories = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  '.cache',
  '.idea',
  '.vscode-test',
  '.pnpm-store',
  '.venv',
  '.docker-secrets',
  '.party-media',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
  'exports',
]);

const excludedFiles = new Set(['.npmrc', 'id_rsa', 'id_ed25519', 'snapshot_manifest.json']);

const excludedExtensions = /\.(pem|key|p12|pfx|log|tsbuildinfo|mp4|mkv|webm|mov|avi|video)$/i;
const maxFileSize = 5 * 1024 * 1024;

function isExcluded(file) {
  const parts = file.replaceAll('\\', '/').split('/');
  const filename = parts.at(-1);
  const lowercase = filename.toLowerCase();

  if (parts.some((part) => excludedDirectories.has(part))) {
    return true;
  }

  if (excludedFiles.has(lowercase)) return true;

  if ((lowercase === '.env' || lowercase.startsWith('.env.')) && lowercase !== '.env.example') {
    return true;
  }

  if (excludedExtensions.test(filename)) return true;

  if (/^(?:\.secret|credentials)(?:\.|$)/i.test(lowercase)) return true;

  return false;
}

function collectFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  return [...new Set(output.toString('utf8').split('\0'))]
    .filter(Boolean)
    .filter((file) => !isExcluded(file))
    .filter((file) => {
      const fullPath = resolve(root, file);

      if (!fullPath.startsWith(root + sep)) return false;
      if (!existsSync(fullPath)) return false;
      if (!lstatSync(fullPath).isFile()) return false;

      return statSync(fullPath).size <= maxFileSize;
    })
    .sort();
}

async function main() {
  const files = collectFiles();

  if (files.length === 0) {
    throw new Error('No source files found.');
  }

  mkdirSync(exportDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const zipPath = join(exportDirectory, `mahoura-party-${timestamp}.zip`);

  const output = createWriteStream(zipPath);
  const archive = new ZipArchive({
    zlib: { level: 9 },
  });

  const completed = new Promise((resolveDone, reject) => {
    output.once('close', resolveDone);
    output.once('error', reject);
    archive.once('error', reject);
  });

  archive.pipe(output);

  archive.append(
    JSON.stringify(
      {
        project: 'mahoura-party',
        createdAt: new Date().toISOString(),
        includedFileCount: files.length,
        files,
        note: 'Review source contents for secrets before sharing. Known private files and build outputs were filtered.',
      },
      null,
      2,
    ),
    { name: 'mahoura-party/SNAPSHOT_MANIFEST.json' },
  );

  for (const file of files) {
    archive.file(resolve(root, file), {
      name: `mahoura-party/${file.replaceAll('\\', '/')}`,
    });
  }

  await archive.finalize();
  await completed;

  console.log('\nSnapshot created successfully!');
  console.log(`Files: ${files.length}`);
  console.log(`Size: ${(statSync(zipPath).size / 1024).toFixed(2)} KB`);
  console.log(`Path: ${zipPath}`);
}

main().catch((error) => {
  console.error('Snapshot failed:', error);
  process.exitCode = 1;
});
