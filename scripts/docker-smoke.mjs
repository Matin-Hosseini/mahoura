import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] ?? 'both';
assert(['dev', 'prod', 'both'].includes(mode), 'Use dev, prod, or both.');
const exerciseRecovery = process.argv.includes('--exercise-dev-recovery');
assert(!exerciseRecovery || mode === 'both', 'Recovery requires both stacks.');

function compose(environment, args) {
  const result = spawnSync(
    'docker',
    ['compose', '--env-file', `.env.${environment}`, '-f', `compose.${environment}.yaml`, ...args],
    { cwd: root, encoding: 'utf8', timeout: 240000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Docker command failed (${environment}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(3000);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('timeout', () => socket.destroy(new Error(`Port ${port} timed out`)));
    socket.once('error', reject);
  });
}

async function verify(environment) {
  const [web, api, postgres, redisPort] =
    environment === 'dev' ? [3000, 3001, 5433, 6380] : [8080, 8081, 5434, 6381];
  await Promise.all([checkPort(postgres), checkPort(redisPort)]);
  const get = (port, path) =>
    fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(10000) });
  const page = await get(web, '/');
  assert.equal(page.status, 200, `${environment}: web page`);
  await page.arrayBuffer();
  const live = await get(api, '/health/live');
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'ok' });
  const ready = await get(api, '/health/ready');
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), {
    status: 'ok',
    checks: { postgres: 'up', redis: 'up' },
  });
  const proxy = await get(web, '/api/health');
  assert.equal(proxy.status, 200);
  assert.deepEqual(await proxy.json(), { status: 'ok' });
  for (const service of ['web', 'api']) {
    assert.notEqual(compose(environment, ['exec', '-T', service, 'id', '-u']), '0');
  }
  console.log(`${environment}: web, API, PostgreSQL, Redis and non-root runtime OK.`);
}

async function eventually(action) {
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      return await action();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(1000);
    }
  }
}

function sql(environment, statement) {
  return compose(environment, [
    'exec',
    '-T',
    'postgres',
    'sh',
    '-ec',
    'export PGPASSWORD="$APP_DB_PASSWORD"; exec psql -h 127.0.0.1 -U "$APP_DB_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -tA -c "$1"',
    'sh',
    statement,
  ]);
}

function redis(environment, ...args) {
  return compose(environment, [
    'exec',
    '-T',
    'redis',
    'sh',
    '-ec',
    'export REDISCLI_AUTH="$REDIS_PASSWORD"; exec redis-cli --raw "$@"',
    'sh',
    ...args,
  ]);
}

if (mode !== 'prod') await verify('dev');
if (mode !== 'dev') await verify('prod');

if (mode === 'both') {
  const marker = `smoke_${randomBytes(12).toString('hex')}`;
  const table = `public.${marker}`;
  try {
    // Only write temporary markers to development; production is read-only here.
    sql('dev', `CREATE TABLE ${table} (value text NOT NULL)`);
    sql('dev', `INSERT INTO ${table} VALUES ('${marker}')`);
    assert.equal(sql('dev', `SELECT value FROM ${table}`), marker);
    assert.equal(sql('prod', `SELECT to_regclass('${table}') IS NULL`), 't');
    assert.equal(redis('dev', 'SET', marker, marker, 'EX', '900'), 'OK');
    assert.equal(redis('dev', 'GET', marker), marker);
    assert.equal(redis('prod', 'EXISTS', marker), '0');
    console.log('Isolation: development PostgreSQL and Redis markers are absent from production.');

    if (exerciseRecovery) {
      // CI only: intentionally interrupt development, never production.
      compose('dev', ['stop', 'redis']);
      try {
        await eventually(async () => {
          const ready = await fetch('http://127.0.0.1:3001/health/ready', {
            signal: AbortSignal.timeout(10000),
          });
          assert.equal(ready.status, 503);
          assert.equal((await ready.json()).checks.redis, 'down');
          const live = await fetch('http://127.0.0.1:3001/health/live', {
            signal: AbortSignal.timeout(10000),
          });
          assert.equal(live.status, 200);
          await live.arrayBuffer();
        });
        await verify('prod');
      } finally {
        compose('dev', ['up', '-d', '--wait', '--wait-timeout', '180', 'redis']);
      }

      // Recreate both data containers without deleting their named volumes.
      compose('dev', [
        'up',
        '-d',
        '--force-recreate',
        '--wait',
        '--wait-timeout',
        '180',
        'postgres',
        'redis',
      ]);
      await eventually(() => verify('dev'));
      assert.equal(sql('dev', `SELECT value FROM ${table}`), marker);
      assert.equal(redis('dev', 'GET', marker), marker);
      await verify('prod');
      console.log('Recovery: data survived container recreation; production stayed available.');
    }
  } finally {
    // The Redis TTL also protects against interrupted runs.
    try {
      sql('dev', `DROP TABLE IF EXISTS ${table}`);
    } finally {
      redis('dev', 'DEL', marker);
    }
  }
}
