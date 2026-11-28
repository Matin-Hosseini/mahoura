import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export const CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 5 * 1024 ** 3;
export const ROOM_HOURS = 24;
export const reactions = ['❤️', '😂', '😍', '😮', '👏', '🥺'] as const;
export type Role = 'host' | 'guest';
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const inviteFor = (host: string) =>
  createHash('sha256').update(`mahoura-invite-v1:${host}`).digest('base64url');
export const validToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const validId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

export function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new BadRequestException(`Enter between 1 and ${max} characters.`);
  }
  return value.trim();
}

export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new BadRequestException('Invalid size or offset.');
  }
  return value;
}

export function playback(value: unknown, playing: unknown) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 86400 ||
    typeof playing !== 'boolean'
  ) {
    throw new BadRequestException('Invalid playback state.');
  }
  return { position: value, playing };
}
