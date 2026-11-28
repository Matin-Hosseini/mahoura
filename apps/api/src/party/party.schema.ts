// Versioned, idempotent schema migrations. Run inside an advisory-locked transaction.
export const PARTY_SCHEMA = `
CREATE TABLE IF NOT EXISTS party_rooms (
  id uuid PRIMARY KEY,
  host_hash text NOT NULL,
  guest_hash text NOT NULL,
  host_name text NOT NULL,
  guest_name text,
  guest_session_hash text,
  expires_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  video_name text,
  video_type text,
  video_fingerprint text,
  video_conversion text,
  video_version integer NOT NULL DEFAULT 0,
  video_completed boolean NOT NULL DEFAULT false,
  video_size bigint NOT NULL DEFAULT 0,
  uploaded bigint NOT NULL DEFAULT 0,
  playing boolean NOT NULL DEFAULT false,
  position double precision NOT NULL DEFAULT 0,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (uploaded >= 0 AND uploaded <= video_size)
);
-- Idempotent migrations for existing development and production databases.
ALTER TABLE party_rooms ADD COLUMN IF NOT EXISTS video_conversion text;
ALTER TABLE party_rooms ADD COLUMN IF NOT EXISTS video_version integer NOT NULL DEFAULT 0;
ALTER TABLE party_rooms ADD COLUMN IF NOT EXISTS video_completed boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS party_rooms_expiry ON party_rooms (expires_at);
CREATE TABLE IF NOT EXISTS party_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('host', 'guest')),
  kind text NOT NULL CHECK (kind IN ('chat', 'reaction')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS party_events_room ON party_events (room_id, kind, id DESC);
`;
