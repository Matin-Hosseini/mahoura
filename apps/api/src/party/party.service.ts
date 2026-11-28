import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { Pool, type PoolClient } from 'pg';
import { PARTY_SCHEMA } from './party.schema';
import { startMkvConversion } from './party.media';
import { PartyTyping } from './party.typing';
import {
  CHUNK_BYTES,
  MAX_VIDEO_BYTES,
  ROOM_HOURS,
  digest,
  integer,
  inviteFor,
  playback,
  reactions,
  text,
  token,
  validId,
  validToken,
  type Role,
} from './party.protocol';

type Room = {
  id: string;
  host_hash: string;
  guest_hash: string;
  host_name: string;
  guest_name: string | null;
  guest_session_hash: string | null;
  expires_at: Date;
  revision: number;
  video_name: string | null;
  video_type: string | null;
  video_fingerprint: string | null;
  video_conversion: 'ready' | 'failed' | null;
  video_version: number;
  video_completed: boolean;
  video_size: string;
  uploaded: string;
  playing: boolean;
  position: number;
  changed_at: Date;
};
const MKV = 'video/x-matroska';
const videoReady = (room: Room) =>
  !!room.video_name &&
  room.video_size === room.uploaded &&
  (room.video_type !== MKV || room.video_conversion === 'ready');

type EventRow = { id: string; role: Role; content: string; created_at: Date };

@Injectable()
export class PartyService implements OnModuleDestroy {
  private readonly logger = new Logger(PartyService.name);
  private readonly pool?: Pool;
  private schema?: Promise<void>;
  private readonly directory = resolve(process.env.PARTY_MEDIA_DIR ?? '.party-media');
  private readonly signals = new EventEmitter();
  private readonly typing = new PartyTyping((id) => this.notify(id));
  private readonly sweep?: ReturnType<typeof setInterval>;
  private closing = false;
  private conversion?: {
    id: string;
    stop: () => Promise<boolean>;
    finished: Promise<void>;
  };

  constructor() {
    const { POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD } = process.env;
    if (POSTGRES_HOST && POSTGRES_DB && POSTGRES_USER && POSTGRES_PASSWORD) {
      this.pool = new Pool({
        host: POSTGRES_HOST,
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        database: POSTGRES_DB,
        user: POSTGRES_USER,
        password: POSTGRES_PASSWORD,
        max: 10,
        connectionTimeoutMillis: 3000,
        statement_timeout: 10000,
      });
      this.pool.on('error', () => this.logger.warn('Party database connection failed'));
      this.sweep = setInterval(() => {
        void this.cleanup().catch(() => this.logger.warn('Party cleanup failed'));
      }, 5 * 60_000);
      this.sweep.unref();
    }
    this.signals.setMaxListeners(0);
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) throw new ServiceUnavailableException('Party database is not configured.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async ready() {
    this.schema ??= this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(820031)');
      await client.query(PARTY_SCHEMA);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
    }).catch((error: unknown) => {
      this.schema = undefined;
      throw error;
    });
    await this.schema;
  }

  private async room(client: PoolClient, id: string, lock = false): Promise<Room> {
    if (!validId(id)) throw new NotFoundException('Room not found.');
    const { rows } = await client.query<Room>(
      `SELECT * FROM party_rooms WHERE id = $1 AND expires_at > clock_timestamp()${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Room not found or expired.');
    return rows[0];
  }

  private role(room: Room, secret: unknown): Role {
    if (!validToken(secret)) throw new UnauthorizedException('An invitation is required.');
    const hash = digest(secret);
    if (hash === room.host_hash) return 'host';
    if (hash === room.guest_session_hash && room.guest_name) return 'guest';
    throw new UnauthorizedException('An invitation is required.');
  }

  private host(room: Room, secret: unknown) {
    if (this.role(room, secret) !== 'host')
      throw new ForbiddenException('Only the host can do this.');
  }

  private mediaPath(id: string, version: number) {
    return resolve(this.directory, `${id}${version ? `.${version}` : ''}.video`);
  }
  private convertedPath(id: string, version: number) {
    return resolve(this.directory, `${id}${version ? `.${version}` : ''}.mp4`);
  }

  private async removeMedia(id: string, version: number) {
    await Promise.all([
      rm(this.mediaPath(id, version), { force: true }),
      rm(this.convertedPath(id, version), { force: true }),
    ]);
  }

  private checkVersion(room: Room, version: unknown) {
    if (version !== undefined && integer(version, 0, 2_147_483_647) !== room.video_version)
      throw new ConflictException('The film has changed. Refresh and try again.');
  }

  private prepareMkv(id: string) {
    if (this.closing || this.conversion) return;
    let version = 0;
    let output = '';
    let job: ReturnType<typeof startMkvConversion> | undefined;
    const finished = this.transaction(async (client) => {
      const { rows } = await client.query<Room>(
        'SELECT * FROM party_rooms WHERE id=$1 AND expires_at > clock_timestamp() FOR UPDATE',
        [id],
      );
      const room = rows[0];
      if (
        this.closing ||
        !room ||
        room.video_type !== MKV ||
        room.video_size !== room.uploaded ||
        room.video_conversion !== null
      )
        return;
      version = room.video_version;
      output = this.convertedPath(id, version);
      job = startMkvConversion(this.mediaPath(id, version), output);
      // Attach rejection handling immediately, including while COMMIT is in flight.
      void job.result.catch(() => false);
    })
      .then(async () => {
        if (!job) return;
        const success = await job.result.catch(() => false);
        if (this.closing) return;
        await this.transaction(async (client) => {
          const { rows } = await client.query<Room>(
            'SELECT * FROM party_rooms WHERE id=$1 AND expires_at > clock_timestamp() FOR UPDATE',
            [id],
          );
          if (!rows[0] || rows[0].video_version !== version) return;
          if (!success) await rm(output, { force: true });
          await client.query(
            'UPDATE party_rooms SET video_conversion=$2, revision=revision+1 WHERE id=$1',
            [id, success ? 'ready' : 'failed'],
          );
        });
        if (!success) this.logger.warn(`MKV conversion failed for room ${id}`);
        this.notify(id);
      })
      .catch(async () => {
        await job?.stop();
        this.logger.warn(`Could not save conversion result for room ${id}`);
      })
      .finally(() => {
        this.conversion = undefined;
      });
    this.conversion = { id, stop: () => job?.stop() ?? Promise.resolve(true), finished };
  }

  notify(id: string) {
    this.signals.emit(id);
  }
  subscribe(id: string, listener: () => void) {
    this.signals.on(id, listener);
    return () => {
      this.signals.off(id, listener);
    };
  }

  onShutdown(listener: () => void) {
    this.signals.on('shutdown', listener);
    return () => {
      this.signals.off('shutdown', listener);
    };
  }

  async create(name: unknown) {
    const hostName = text(name, 40);
    await this.ready();
    await this.cleanup();
    const id = randomUUID();
    const hostToken = token();
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(820032)');
      const count = await client.query<{ total: string }>(
        'SELECT count(*) AS total FROM party_rooms',
      );
      if (Number(count.rows[0]?.total) >= 12)
        throw new HttpException('Room capacity reached. Try later.', 429);
      await client.query(
        "INSERT INTO party_rooms (id, host_hash, guest_hash, host_name, expires_at) VALUES ($1,$2,$3,$4,clock_timestamp() + $5 * interval '1 hour')",
        [id, digest(hostToken), digest(inviteFor(hostToken)), hostName, ROOM_HOURS],
      );
    });
    return { id, hostToken };
  }

  async join(id: string, invite: unknown, name: unknown) {
    const guestName = text(name, 40);
    if (!validToken(invite)) throw new UnauthorizedException('Invalid invitation.');
    await this.ready();
    const guestToken = token();
    await this.transaction(async (client) => {
      const room = await this.room(client, id, true);
      if (digest(invite) !== room.guest_hash)
        throw new UnauthorizedException('Invalid invitation.');
      if (room.guest_name) throw new ConflictException('This invitation has already been used.');
      await client.query(
        'UPDATE party_rooms SET guest_name=$2, guest_session_hash=$3, revision=revision+1 WHERE id=$1',
        [id, guestName, digest(guestToken)],
      );
    });
    this.notify(id);
    return guestToken;
  }

  async snapshot(id: string, secret: unknown) {
    await this.ready();
    const state = await this.transaction(async (client) => {
      // The row lock serializes the state and event history with room mutations.
      const room = await this.room(client, id, true);
      const role = this.role(room, secret);
      const chat = await client.query<EventRow>(
        "SELECT id, role, content, created_at FROM party_events WHERE room_id=$1 AND kind='chat' ORDER BY id DESC LIMIT 100",
        [id],
      );
      const recent = await client.query<EventRow>(
        "SELECT id, role, content, created_at FROM party_events WHERE room_id=$1 AND kind='reaction' AND created_at > clock_timestamp() - interval '5 seconds' ORDER BY id DESC LIMIT 20",
        [id],
      );
      const now = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
      return {
        id,
        role,
        hostName: room.host_name,
        guestName: room.guest_name,
        revision: room.revision,
        expiresAt: room.expires_at.toISOString(),
        serverNow: now.rows[0].now.getTime(),
        invite:
          role === 'host' && !room.guest_name && validToken(secret) ? inviteFor(secret) : undefined,
        video: room.video_name
          ? {
              name: room.video_name,
              version: room.video_version,
              completed: room.video_completed,
              size: Number(room.video_size),
              uploaded: Number(room.uploaded),
              ready: videoReady(room),
              processing:
                room.video_type === MKV &&
                room.video_size === room.uploaded &&
                room.video_conversion === null,
              failed: room.video_conversion === 'failed',
            }
          : null,
        playback: {
          playing: room.playing,
          position: room.position,
          changedAt: room.changed_at.getTime(),
        },
        chat: chat.rows.reverse(),
        reactions: recent.rows.reverse(),
        typing: this.typing.snapshot(id),
      };
    });
    // Also restarts interrupted preparation after an API restart. SSE polling
    // schedules waiting rooms once the single conversion slot is available.
    if (state.video?.processing) this.prepareMkv(id);
    return state;
  }

  async reserve(id: string, secret: unknown, body: Record<string, unknown>) {
    const name = text(body.name, 200);
    const size = integer(body.size, 1, MAX_VIDEO_BYTES);
    const type = body.type;
    const fingerprint = body.fingerprint;
    if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint))
      throw new BadRequestException('Invalid video fingerprint.');
    if (type !== 'video/mp4' && type !== 'video/webm' && type !== MKV)
      throw new BadRequestException('Use an MP4, WebM or MKV video.');
    await this.ready();
    const previousVersion = await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(820032)');
      const room = await this.room(client, id, true);
      this.host(room, secret);
      if (room.video_name) {
        if (
          room.video_name === name &&
          Number(room.video_size) === size &&
          room.video_type === type &&
          room.video_fingerprint === fingerprint &&
          Number(room.uploaded) < size
        )
          return undefined;
        if (!room.video_completed && room.video_conversion !== 'failed')
          throw new ConflictException('Finish the current film before choosing the next one.');
      }
      const sum = await client.query<{ total: string }>(
        'SELECT coalesce(sum(video_size + CASE WHEN video_type=$1 THEN $2::bigint ELSE 0 END),0) AS total FROM party_rooms WHERE id <> $3',
        [MKV, MAX_VIDEO_BYTES, id],
      );
      if (Number(sum.rows[0]?.total) + size + (type === MKV ? MAX_VIDEO_BYTES : 0) > 15 * 1024 ** 3)
        throw new HttpException('Media storage capacity reached.', 507);
      await client.query(
        `UPDATE party_rooms
         SET video_name=$2, video_size=$3, video_type=$4, video_fingerprint=$5,
             uploaded=0, video_conversion=NULL, video_completed=false,
             video_version=video_version+1, playing=false, position=0,
             changed_at=clock_timestamp(), revision=revision+1
         WHERE id=$1`,
        [id, name, size, type, fingerprint],
      );
      return room.video_name ? room.video_version : undefined;
    });
    if (previousVersion !== undefined) await this.removeMedia(id, previousVersion);
    this.notify(id);
    return this.snapshot(id, secret);
  }

  async upload(id: string, secret: unknown, offset: number, bytes: Buffer, version?: number) {
    integer(offset, 0, MAX_VIDEO_BYTES);
    if (!bytes.length || bytes.length > CHUNK_BYTES)
      throw new BadRequestException('Invalid chunk length.');
    await this.ready();
    const result = await this.transaction(async (client) => {
      const room = await this.room(client, id, true);
      this.host(room, secret);
      this.checkVersion(room, version);
      const current = Number(room.uploaded);
      if (
        !room.video_name ||
        offset !== current ||
        current + bytes.length > Number(room.video_size)
      )
        throw new ConflictException('Upload offset changed. Refresh and retry the same file.');
      if (current === 0) {
        const valid =
          room.video_type === 'video/mp4'
            ? bytes.subarray(4, 8).toString('ascii') === 'ftyp'
            : bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
        if (!valid)
          throw new BadRequestException('The video container does not match the selected format.');
      }
      const file = await open(
        this.mediaPath(id, room.video_version),
        current === 0 ? 'w+' : 'r+',
        0o600,
      );
      try {
        const info = await file.stat();
        if (info.size < current)
          throw new ServiceUnavailableException('Stored video is incomplete.');
        await file.truncate(current);
        let written = 0;
        while (written < bytes.length) {
          const result = await file.write(
            bytes,
            written,
            bytes.length - written,
            current + written,
          );
          if (!result.bytesWritten) throw new Error('Media write failed.');
          written += result.bytesWritten;
        }
        await file.sync();
      } finally {
        await file.close();
      }
      const next = current + bytes.length;
      await client.query('UPDATE party_rooms SET uploaded=$2, revision=revision+1 WHERE id=$1', [
        id,
        next,
      ]);
      return {
        uploaded: next,
        convert: room.video_type === MKV && next === Number(room.video_size),
      };
    });
    if (result.convert) this.prepareMkv(id);
    this.notify(id);
    return { uploaded: result.uploaded };
  }

  async media(id: string, secret: unknown, version?: number) {
    await this.ready();
    return this.transaction(async (client) => {
      const room = await this.room(client, id);
      this.role(room, secret);
      this.checkVersion(room, version);
      if (!room.video_type || !videoReady(room)) throw new NotFoundException('Video is not ready.');
      return room.video_type === MKV
        ? { path: this.convertedPath(id, room.video_version), type: 'video/mp4' }
        : { path: this.mediaPath(id, room.video_version), type: room.video_type };
    });
  }

  async control(id: string, secret: unknown, body: Record<string, unknown>) {
    const state = playback(body.position, body.playing);
    const completed = body.completed ?? false;
    if (typeof completed !== 'boolean' || (completed && state.playing))
      throw new BadRequestException('Invalid video completion state.');
    await this.ready();
    await this.transaction(async (client) => {
      const room = await this.room(client, id, true);
      this.host(room, secret);
      this.checkVersion(room, body.version);
      if (!videoReady(room)) throw new ConflictException('Video is not ready.');
      await client.query(
        `UPDATE party_rooms
         SET position=$2, playing=$3,
             video_completed=CASE WHEN $4 THEN true WHEN $3 THEN false ELSE video_completed END,
             changed_at=clock_timestamp(), revision=revision+1
         WHERE id=$1`,
        [id, state.position, state.playing, completed],
      );
    });
    this.notify(id);
    return this.snapshot(id, secret);
  }

  async setTyping(id: string, secret: unknown, value: unknown) {
    if (typeof value !== 'boolean') throw new BadRequestException('Invalid typing state.');
    await this.ready();
    const role = await this.transaction(async (client) => {
      const room = await this.room(client, id);
      return this.role(room, secret);
    });
    this.typing.set(id, role, value);
    return { ok: true };
  }

  async event(id: string, secret: unknown, kind: 'chat' | 'reaction', value: unknown) {
    const content = text(value, kind === 'chat' ? 500 : 10);
    if (kind === 'reaction' && !reactions.some((emoji) => emoji === content))
      throw new BadRequestException('Unknown reaction.');
    await this.ready();
    const role = await this.transaction(async (client) => {
      const room = await this.room(client, id, true);
      const currentRole = this.role(room, secret);
      const recent = await client.query(
        "SELECT 1 FROM party_events WHERE room_id=$1 AND role=$2 AND kind=$3 AND created_at > clock_timestamp() - interval '500 milliseconds' LIMIT 1",
        [id, currentRole, kind],
      );
      if (recent.rowCount) throw new HttpException('Please slow down.', 429);
      await client.query(
        'INSERT INTO party_events(room_id, role, kind, content) VALUES ($1,$2,$3,$4)',
        [id, currentRole, kind, content],
      );
      await client.query(
        'DELETE FROM party_events WHERE room_id=$1 AND kind=$2 AND id NOT IN (SELECT id FROM party_events WHERE room_id=$1 AND kind=$2 ORDER BY id DESC LIMIT $3)',
        [id, kind, kind === 'chat' ? 100 : 20],
      );
      await client.query('UPDATE party_rooms SET revision=revision+1 WHERE id=$1', [id]);
      return currentRole;
    });
    if (kind === 'chat') this.typing.set(id, role, false);
    this.notify(id);
    return { ok: true };
  }

  private async cleanup() {
    await this.ready();
    await this.transaction(async (client) => {
      const { rows } = await client.query<{ id: string; video_version: number }>(
        'SELECT id, video_version FROM party_rooms WHERE expires_at <= clock_timestamp() FOR UPDATE SKIP LOCKED',
      );
      for (const { id, video_version } of rows) {
        this.typing.delete(id);
        // Wait for the process to close, not its database update (which also
        // takes the room lock), before deleting media.
        if (this.conversion?.id === id) await this.conversion.stop();
        await this.removeMedia(id, video_version);
        await client.query('DELETE FROM party_rooms WHERE id=$1', [id]);
        this.notify(id);
      }
    });
  }

  async close(id: string, secret: unknown) {
    await this.ready();
    await this.transaction(async (client) => {
      const room = await this.room(client, id, true);
      this.host(room, secret);
      await client.query('UPDATE party_rooms SET expires_at=clock_timestamp() WHERE id=$1', [id]);
    });
    this.notify(id);
    await this.cleanup();
    return { ok: true };
  }

  async onModuleDestroy() {
    this.closing = true;
    clearInterval(this.sweep);
    this.typing.clear();
    const conversion = this.conversion;
    if (conversion) {
      await conversion.stop();
      await conversion.finished;
    }
    this.signals.emit('shutdown');
    this.signals.removeAllListeners();
    await this.pool?.end();
  }
}
