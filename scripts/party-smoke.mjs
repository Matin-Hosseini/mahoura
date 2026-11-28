import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const mode = process.argv[2] ?? 'dev';
assert(['dev', 'prod'].includes(mode), 'Use dev or prod.');
const base = `http://127.0.0.1:${mode === 'dev' ? 3000 : 8080}/api/party/rooms`;

async function call(
  path,
  {
    method = 'GET',
    cookie,
    json,
    body,
    headers = {},
    status = 200,
    signal = AbortSignal.timeout(15000),
  } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    signal,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: json === undefined ? body : JSON.stringify(json),
  });
  if (response.status !== status) {
    const error = await response.text();
    throw new Error(
      `${method} ${path}: expected ${status}, received ${response.status}: ${error.slice(0, 300)}`,
    );
  }
  return response;
}
const json = async (path, options) => (await call(path, options)).json();
const cookie = (response) => {
  const value = response.headers.get('set-cookie');
  assert(
    value && /HttpOnly/i.test(value) && /SameSite=Strict/i.test(value),
    'Protected room cookie',
  );
  return value.split(';')[0];
};

async function waitFor(reader, predicate) {
  const decoder = new TextDecoder();
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    assert(!done, 'SSE ended before expected update');
    pending += decoder.decode(value, { stream: true });
    let end;
    while ((end = pending.indexOf('\n\n')) !== -1) {
      const frame = pending.slice(0, end);
      pending = pending.slice(end + 2);
      const line = frame.split('\n').find((part) => part.startsWith('data: '));
      if (line) {
        const state = JSON.parse(line.slice(6));
        if (predicate(state)) return state;
      }
    }
  }
}

let room;
let host;
let reader;
try {
  const created = await call('', {
    method: 'POST',
    json: { name: 'Smoke Host' },
    status: 201,
  });
  host = cookie(created);
  room = `/${(await created.json()).id}`;
  const initial = await json(room, { cookie: host });
  assert.equal(initial.role, 'host');
  assert(initial.invite);
  await call(room, { status: 401 });
  await call(`${room}/join`, {
    method: 'POST',
    json: { invite: 'wrong', name: 'Intruder' },
    status: 401,
  });
  const joined = await call(`${room}/join`, {
    method: 'POST',
    json: { invite: initial.invite, name: 'Smoke Guest' },
  });
  const guest = cookie(joined);
  assert.notEqual(guest, host);
  assert.equal((await json(room, { cookie: guest })).role, 'guest');
  await call(`${room}/join`, {
    method: 'POST',
    json: { invite: initial.invite, name: 'Third person' },
    status: 409,
  });
  await call(`${room}/video`, { status: 401 });
  await call(`${room}/playback`, {
    method: 'POST',
    cookie: guest,
    json: { playing: true, position: 0 },
    status: 403,
  });
  await call(room, { method: 'DELETE', cookie: guest, status: 403 });

  // Synthetic ftyp container header, deliberately not a decodable movie.
  // The smoke test exercises transport and byte ranges, not browser codecs.
  const sample = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypisom'),
    Buffer.alloc(20, 7),
  ]);
  const metadata = {
    name: 'smoke.mp4',
    type: 'video/mp4',
    size: sample.length,
    fingerprint: createHash('sha256')
      .update(Buffer.concat([sample, sample]))
      .digest('hex'),
  };
  await call(`${room}/video`, { method: 'POST', cookie: guest, json: metadata, status: 403 });
  const firstVideo = await json(`${room}/video`, { method: 'POST', cookie: host, json: metadata });
  const firstVideoVersion = firstVideo.video.version;
  const nextSample = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypisom'),
    Buffer.alloc(28, 9),
  ]);
  const nextMetadata = {
    name: 'second-film.mp4',
    type: 'video/mp4',
    size: nextSample.length,
    fingerprint: createHash('sha256')
      .update(Buffer.concat([nextSample, nextSample]))
      .digest('hex'),
  };
  await call(`${room}/video`, {
    method: 'POST',
    cookie: host,
    json: nextMetadata,
    status: 409,
  });
  const put = (offset, body, status = 200, version = firstVideoVersion) =>
    call(`${room}/video?offset=${offset}&v=${version}`, {
      method: 'PUT',
      cookie: host,
      body,
      headers: { 'Content-Type': 'application/octet-stream' },
      status,
    });
  await put(1, sample.subarray(0, 12), 409);
  await put(0, sample.subarray(0, 12));
  const resume = await json(`${room}/video`, { method: 'POST', cookie: host, json: metadata });
  assert.equal(resume.video.uploaded, 12);
  await put(12, sample.subarray(12));
  const range = await call(`${room}/video`, {
    cookie: guest,
    headers: { Range: 'bytes=4-7' },
    status: 206,
  });
  assert.equal(range.headers.get('content-range'), `bytes 4-7/${sample.length}`);
  assert.equal(await range.text(), 'ftyp');
  await call(`${room}/video`, { cookie: guest, headers: { Range: 'bytes=999-1000' }, status: 416 });
  const head = await call(`${room}/video`, { method: 'HEAD', cookie: guest });
  assert.equal(Number(head.headers.get('content-length')), sample.length);
  assert.deepEqual(
    Buffer.from(await (await call(`${room}/video`, { cookie: host })).arrayBuffer()),
    sample,
  );

  const stream = await call(`${room}/events`, {
    cookie: guest,
    signal: AbortSignal.timeout(30000),
  });
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  reader = stream.body.getReader();
  await waitFor(reader, (state) => state.video?.ready);
  await call(`${room}/typing`, { method: 'POST', json: { typing: true }, status: 401 });
  await call(`${room}/typing`, {
    method: 'POST',
    cookie: guest,
    json: { typing: 'yes' },
    status: 400,
  });
  await json(`${room}/typing`, { method: 'POST', cookie: guest, json: { typing: true } });
  await waitFor(reader, (state) => state.typing.guest === true);
  await json(`${room}/typing`, { method: 'POST', cookie: guest, json: { typing: false } });
  await waitFor(reader, (state) => state.typing.guest === false);
  await json(`${room}/typing`, { method: 'POST', cookie: guest, json: { typing: true } });
  await waitFor(reader, (state) => state.typing.guest === true);
  await waitFor(reader, (state) => state.typing.guest === false);
  await json(`${room}/typing`, { method: 'POST', cookie: guest, json: { typing: true } });
  await waitFor(reader, (state) => state.typing.guest === true);
  await json(`${room}/chat`, {
    method: 'POST',
    cookie: guest,
    json: { content: 'Hello from guest' },
  });
  await waitFor(
    reader,
    (state) =>
      state.typing.guest === false &&
      state.chat.some((event) => event.content === 'Hello from guest'),
  );
  await json(`${room}/playback`, {
    method: 'POST',
    cookie: host,
    json: { playing: true, position: 2 },
  });
  await waitFor(reader, (state) => state.playback.playing && state.playback.position === 2);
  await json(`${room}/playback`, {
    method: 'POST',
    cookie: host,
    json: { playing: false, position: 3 },
  });
  await waitFor(reader, (state) => !state.playback.playing && state.playback.position === 3);
  await json(`${room}/reaction`, { method: 'POST', cookie: host, json: { content: '❤️' } });
  await waitFor(reader, (state) => state.reactions.some((event) => event.content === '❤️'));
  assert.equal((await json(room, { cookie: host })).chat.at(-1).content, 'Hello from guest');
  await json(`${room}/playback`, {
    method: 'POST',
    cookie: host,
    json: { playing: false, position: 32, completed: true },
  });
  await waitFor(reader, (state) => state.video?.completed === true);

  const next = await json(`${room}/video`, {
    method: 'POST',
    cookie: host,
    json: nextMetadata,
  });
  assert.equal(next.video.name, nextMetadata.name);
  assert.equal(next.video.version, firstVideoVersion + 1);
  assert.equal(next.video.completed, false);
  assert.equal(next.video.uploaded, 0);
  await put(0, nextSample, 409);
  await put(0, nextSample, 200, next.video.version);
  await call(`${room}/video?v=${firstVideoVersion}`, { cookie: guest, status: 409 });
  await call(`${room}/playback`, {
    method: 'POST',
    cookie: host,
    json: { playing: true, position: 0, version: firstVideoVersion },
    status: 409,
  });
  assert.equal((await json(room, { cookie: guest })).playback.playing, false);
  await waitFor(reader, (state) => state.video?.ready && state.video.name === nextMetadata.name);
  const nextRange = await call(`${room}/video`, {
    cookie: guest,
    headers: { Range: 'bytes=12-12' },
    status: 206,
  });
  assert.deepEqual(Buffer.from(await nextRange.arrayBuffer()), Buffer.from([9]));
  await reader.cancel();
  reader = undefined;
  await json(room, { method: 'DELETE', cookie: host });
  await call(room, { cookie: guest, status: 404 });
  room = undefined;
  console.log(
    `${mode}: private room, one-time invite, upload/resume, sequential films, byte ranges, SSE playback, typing, chat, reactions and cleanup OK.`,
  );
  if (process.argv.includes('--mkv')) {
    const mkv = Buffer.from(
      await readFile(new URL('../apps/web/e2e/fixtures/sample.mkv.b64', import.meta.url), 'utf8'),
      'base64',
    );
    for (const [mkvSample, valid] of [
      [mkv, true],
      [Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), false],
    ]) {
      const created = await call('', {
        method: 'POST',
        json: { name: 'MKV Smoke Host' },
        status: 201,
      });
      host = cookie(created);
      room = `/${(await created.json()).id}`;
      await json(`${room}/video`, {
        method: 'POST',
        cookie: host,
        json: {
          name: 'sample.mkv',
          type: 'video/x-matroska',
          size: mkvSample.length,
          fingerprint: createHash('sha256')
            .update(Buffer.concat([mkvSample, mkvSample]))
            .digest('hex'),
        },
      });
      await json(`${room}/video?offset=0`, {
        method: 'PUT',
        cookie: host,
        body: mkvSample,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      const deadline = Date.now() + 60_000;
      let state;
      do {
        state = await json(room, { cookie: host });
        if (state.video.ready || state.video.failed) break;
        await sleep(250);
      } while (Date.now() < deadline);
      assert.equal(state.video.ready, valid, 'MKV readiness');
      assert.equal(state.video.failed, !valid, 'MKV failure state');
      if (valid) {
        const response = await call(`${room}/video`, {
          cookie: host,
          headers: { Range: 'bytes=4-7' },
          status: 206,
        });
        assert.match(response.headers.get('content-type'), /video\/mp4/);
        assert.equal(await response.text(), 'ftyp');
      } else {
        await call(`${room}/video`, { cookie: host, status: 404 });
      }
      // Both a completed MKV and a failed conversion can be replaced in the same room.
      if (valid) {
        await json(`${room}/playback`, {
          method: 'POST',
          cookie: host,
          json: { playing: false, position: 1, completed: true, version: state.video.version },
        });
      }
      const replacement = await json(`${room}/video`, {
        method: 'POST',
        cookie: host,
        json: metadata,
      });
      assert.equal(replacement.video.version, state.video.version + 1);
      await json(`${room}/video?offset=0&v=${replacement.video.version}`, {
        method: 'PUT',
        cookie: host,
        body: sample,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      assert.equal((await json(room, { cookie: host })).video.ready, true);
      await json(room, { method: 'DELETE', cookie: host });
      await call(room, { cookie: host, status: 404 });
      room = undefined;
    }
    console.log(`${mode}: MKV conversion, MP4 byte ranges and invalid MKV handling OK.`);
  }
} finally {
  if (reader) await reader.cancel().catch(() => undefined);
  if (room && host) await call(room, { method: 'DELETE', cookie: host }).catch(() => undefined);
}
