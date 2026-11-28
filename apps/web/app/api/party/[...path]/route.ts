export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const roomId = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const allowed = new RegExp(
  `^rooms(?:/${roomId}(?:/(?:join|events|video|playback|chat|reaction|typing))?)?$`,
);
const maxChunk = 4 * 1024 * 1024;
type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: Request, context: Context) {
  const path = (await context.params).path.join('/');
  if (!allowed.test(path)) return new Response('Not found', { status: 404 });
  const unsafe = !['GET', 'HEAD'].includes(request.method);
  if (unsafe && ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '')) {
    return new Response('Forbidden', { status: 403 });
  }
  const base = process.env.API_INTERNAL_URL;
  if (!base) return new Response('API unavailable', { status: 503 });
  const url = new URL(`/api/party/${path}`, base);
  const incoming = new URL(request.url);
  if (path.endsWith('/video')) url.search = incoming.search;
  const headers = new Headers();
  for (const key of ['cookie', 'content-type', 'range', 'if-range']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  let body: ArrayBuffer | undefined;
  if (unsafe && request.body) {
    const limit = request.method === 'PUT' ? maxChunk : 16 * 1024;
    if (Number(request.headers.get('content-length')) > limit)
      return new Response('Body too large', { status: 413 });
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return new Response('Body too large', { status: 413 });
      }
      chunks.push(value);
    }
    const data = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) {
      data.set(chunk, position);
      position += chunk.byteLength;
    }
    body = data.buffer;
  }
  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal: request.signal,
    });
    const responseHeaders = new Headers({
      'Cache-Control': 'private, no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const key of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'x-accel-buffering',
    ]) {
      const value = upstream.headers.get(key);
      if (value) responseHeaders.set(key, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) {
      const secure =
        incoming.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
      responseHeaders.append('set-cookie', secure ? `${cookie}; Secure` : cookie);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return new Response('API unavailable', { status: 503 });
  }
}
export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
