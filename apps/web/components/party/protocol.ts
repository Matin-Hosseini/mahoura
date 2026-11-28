export type PartyEvent = {
  id: string;
  role: 'host' | 'guest';
  content: string;
  created_at: string;
};
export type Snapshot = {
  id: string;
  role: 'host' | 'guest';
  hostName: string;
  guestName: string | null;
  revision: number;
  expiresAt: string;
  serverNow: number;
  invite?: string;
  video: {
    name: string;
    version: number;
    completed: boolean;
    size: number;
    uploaded: number;
    ready: boolean;
    processing: boolean;
    failed: boolean;
  } | null;
  playback: { playing: boolean; position: number; changedAt: number };
  chat: PartyEvent[];
  reactions: PartyEvent[];
  typing: { host: boolean; guest: boolean };
};
export const emojis = ['❤️', '😂', '😍', '😮', '👏', '🥺'];
export function videoType(name: string) {
  if (/\.mp4$/i.test(name)) return 'video/mp4';
  if (/\.webm$/i.test(name)) return 'video/webm';
  if (/\.mkv$/i.test(name)) return 'video/x-matroska';
  return '';
}
export const chunkSize = 4 * 1024 * 1024;
export const roomPath = (id: string) => `/api/party/rooms/${id}`;
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    signal,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const error = (await response.json()) as { message?: string };
      if (typeof error.message === 'string') message = error.message;
    } catch {
      /* Proxy errors may not be JSON. */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}
export function targetPosition(state: Snapshot['playback'], serverNow: number, duration: number) {
  const target =
    state.position + (state.playing ? Math.max(0, serverNow - state.changedAt) / 1000 : 0);
  return Math.max(0, Math.min(Number.isFinite(duration) ? duration : target, target));
}
export function clock(seconds: number) {
  const total = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, '0')}`;
}

// A small first/last sample prevents accidental resume with a different file of the same size.
// This is an identity hint, not a full-file integrity checksum.
export async function videoFingerprint(file: File) {
  if (!globalThis.crypto?.subtle) throw new Error('Video upload requires localhost or HTTPS.');
  const sampleSize = 64 * 1024;
  const first = await file.slice(0, sampleSize).arrayBuffer();
  const last = await file.slice(Math.max(0, file.size - sampleSize)).arrayBuffer();
  const sample = new Uint8Array(first.byteLength + last.byteLength);
  sample.set(new Uint8Array(first));
  sample.set(new Uint8Array(last), first.byteLength);
  const hash = await crypto.subtle.digest('SHA-256', sample);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
