export const dynamic = 'force-dynamic';

export async function GET() {
  const baseUrl = process.env.API_INTERNAL_URL;

  if (baseUrl) {
    try {
      const response = await fetch(new URL('/health/ready', baseUrl), {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
      }
    } catch {
      // Do not disclose internal addresses or connection errors to callers.
    }
  }

  return Response.json(
    { status: 'unavailable' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
