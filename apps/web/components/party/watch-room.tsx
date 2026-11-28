'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LuArrowRight,
  LuCheck,
  LuCopy,
  LuFilm,
  LuLogOut,
  LuMaximize,
  LuPause,
  LuPlay,
  LuSend,
  LuUpload,
  LuVolume2,
} from 'react-icons/lu';
import {
  api,
  chunkSize,
  clock,
  emojis,
  roomPath,
  targetPosition,
  videoFingerprint,
  videoType,
  type Snapshot,
} from './protocol';
import styles from './party.module.css';

export function WatchRoom({ id }: { id: string }) {
  const router = useRouter();
  const path = roomPath(id);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [invite, setInvite] = useState('');
  const [name, setName] = useState('');
  const [booting, setBooting] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const current = useRef<Snapshot | null>(null);
  const received = useRef(0);
  const chatEnd = useRef<HTMLDivElement>(null);
  const command = useRef(false);
  const completionPending = useRef(false);
  const uploadLock = useRef(false);
  const typingActive = useRef(false);
  const typingLastSent = useRef(0);
  const typingTimer = useRef<number | null>(null);
  const typingQueue = useRef<Promise<void>>(Promise.resolve());
  const typingSequence = useRef(0);
  const [seek, setSeek] = useState<number | null>(null);

  const accept = useCallback((value: Snapshot) => {
    if (
      current.current &&
      (value.revision < current.current.revision || value.serverNow < current.current.serverNow)
    )
      return;
    current.current = value;
    setOrigin(location.origin);
    received.current = performance.now();
    setSnapshot(value);
  }, []);
  const report = (error: unknown) =>
    setError(error instanceof Error ? error.message : 'Something went wrong.');
  const publishTyping = useCallback(
    (typing: boolean) => {
      // Serialize requests, but discard superseded signals that have not started yet.
      const sequence = ++typingSequence.current;
      typingQueue.current = typingQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (sequence !== typingSequence.current) return;
          await api<{ ok: boolean }>(
            `${path}/typing`,
            'POST',
            { typing },
            AbortSignal.timeout(2000),
          );
        })
        .catch(() => undefined);
    },
    [path],
  );
  const stopTyping = useCallback(() => {
    if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    typingTimer.current = null;
    if (!typingActive.current) return;
    typingActive.current = false;
    publishTyping(false);
  }, [publishTyping]);
  const updateTyping = useCallback(
    (value: string) => {
      if (!value.trim()) {
        stopTyping();
        return;
      }
      const now = Date.now();
      if (!typingActive.current || now - typingLastSent.current >= 1600) {
        typingActive.current = true;
        typingLastSent.current = now;
        publishTyping(true);
      }
      if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(stopTyping, 2400);
    },
    [publishTyping, stopTyping],
  );

  useEffect(() => {
    let active = true;
    // The invite is a fragment, never part of HTTP requests or referrer URLs.
    const secret = new URLSearchParams(location.hash.slice(1)).get('invite') ?? '';
    void api<Snapshot>(path)
      .then((value) => {
        if (!active) return;
        accept(value);
        history.replaceState(null, '', location.pathname);
      })
      .catch(() => {
        if (active) setInvite(secret);
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, [path, accept]);

  const joined = snapshot !== null;
  useEffect(() => {
    if (!joined) return;
    const events = new EventSource(`${path}/events`);
    let active = true;
    events.onopen = () => {
      if (active) setConnected(true);
    };
    events.onmessage = (event: MessageEvent<string>) => {
      if (!active) return;
      try {
        accept(JSON.parse(event.data) as Snapshot);
      } catch {
        setError('Invalid room update.');
      }
    };
    events.onerror = () => {
      if (!active) return;
      setConnected(false);
      void api<Snapshot>(path)
        .then((value) => {
          if (active) accept(value);
        })
        .catch((failure: unknown) => {
          if (
            active &&
            failure instanceof Error &&
            /not found|expired|invitation/i.test(failure.message)
          ) {
            events.close();
            setError('This room has ended or expired.');
            setSnapshot(null);
          }
        });
    };
    return () => {
      active = false;
      events.close();
    };
  }, [joined, path, accept]);

  const synchronize = useCallback(() => {
    const element = video.current;
    const state = current.current;
    if (!element || !state?.video?.ready || element.readyState < 1 || command.current) return;
    const now = state.serverNow + performance.now() - received.current;
    const target = targetPosition(state.playback, now, element.duration);
    if (Math.abs(element.currentTime - target) > (state.playback.playing ? 0.8 : 0.15))
      element.currentTime = target;
    if (state.playback.playing && !element.ended && element.paused) {
      void element
        .play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    } else if (!state.playback.playing) {
      element.pause();
    }
  }, []);
  useEffect(() => {
    synchronize();
    const timer = window.setInterval(synchronize, 1000);
    return () => window.clearInterval(timer);
  }, [snapshot, synchronize]);
  useEffect(() => () => stopTyping(), [stopTyping]);

  const lastChat = snapshot?.chat.at(-1)?.id;
  const otherRole = snapshot?.role === 'host' ? 'guest' : 'host';
  const otherTyping = snapshot?.typing?.[otherRole] ?? false;
  const otherName = snapshot?.role === 'host' ? snapshot.guestName : snapshot?.hostName;
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [lastChat, otherTyping]);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`${path}/join`, 'POST', { invite, name });
      accept(await api<Snapshot>(path));
      history.replaceState(null, '', location.pathname);
      setInvite('');
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (uploadLock.current) return;
    uploadLock.current = true;
    setUploading(true);
    setError('');
    try {
      const type = videoType(file.name);
      if (!type || file.size < 1 || file.size > 5 * 1024 ** 3)
        throw new Error('Choose an MP4, WebM or MKV file up to 5 GiB.');
      const state = await api<Snapshot>(`${path}/video`, 'POST', {
        name: file.name,
        size: file.size,
        type,
        fingerprint: await videoFingerprint(file),
      });
      accept(state);
      if (!state.video) throw new Error('Video reservation is missing.');
      const version = state.video.version;
      let offset = state.video.uploaded;
      setProgress(offset / file.size);
      while (offset < file.size) {
        const chunk = file.slice(offset, offset + chunkSize);
        const response = await fetch(`${path}/video?offset=${offset}&v=${version}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk,
        });
        if (!response.ok) throw new Error('Upload interrupted. Select the same file to resume.');
        const result = (await response.json()) as { uploaded: number };
        if (result.uploaded !== offset + chunk.size) throw new Error('Unexpected upload offset.');
        offset = result.uploaded;
        setProgress(offset / file.size);
      }
      accept(await api<Snapshot>(path));
    } catch (error) {
      report(error);
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  }

  async function control(playing: boolean, at?: number, completed = false) {
    const element = video.current;
    const state = current.current;
    if (!element || state?.role !== 'host' || !state.video?.ready) return;
    const version = state.video.version;
    if (command.current) {
      if (completed) completionPending.current = true;
      return;
    }
    command.current = true;
    setBusy(true);
    setError('');
    const next = Math.max(0, Math.min(element.duration || 0, at ?? element.currentTime));
    // Start play inside the click gesture; revert to the authoritative state on failure.
    if (at !== undefined) element.currentTime = next;
    if (playing)
      void element
        .play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    else element.pause();
    try {
      accept(
        await api<Snapshot>(`${path}/playback`, 'POST', {
          playing,
          position: next,
          completed,
          version,
        }),
      );
    } catch (error) {
      report(error);
    } finally {
      command.current = false;
      setBusy(false);
      setSeek(null);
      const shouldComplete = completionPending.current;
      completionPending.current = false;
      if (shouldComplete && !completed) void control(false, undefined, true);
      else synchronize();
    }
  }

  function unlock() {
    const element = video.current;
    if (!element) return;
    void element
      .play()
      .then(() => {
        setBlocked(false);
        if (!current.current?.playback.playing) element.pause();
        synchronize();
      })
      .catch(() => setBlocked(true));
  }

  async function send(kind: 'chat' | 'reaction', content: string) {
    if (kind === 'chat') stopTyping();
    setError('');
    try {
      if (kind === 'chat') await typingQueue.current;
      await api(`${path}/${kind}`, 'POST', { content });
      if (kind === 'chat') setMessage((previous) => (previous === content ? '' : previous));
    } catch (error) {
      report(error);
    }
  }

  async function copyInvite() {
    if (!snapshot?.invite) return;
    const url = `${location.origin}/room/${id}#invite=${snapshot.invite}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError('Copy the invitation from the field below.');
    }
  }

  async function closeRoom() {
    if (!window.confirm('End this room and delete its uploaded video and chat?')) return;
    try {
      await api(path, 'DELETE');
      router.replace('/');
    } catch (error) {
      report(error);
    }
  }

  if (booting)
    return (
      <main className={styles.landing}>
        <p role="status">Opening your cinema…</p>
      </main>
    );
  if (!snapshot)
    return (
      <main className={styles.landing}>
        <Link href="/" className={styles.brand}>
          <span className={styles.logo}>M</span> mahoura.
        </Link>
        <form
          className={styles.createCard}
          onSubmit={(event) => {
            void join(event);
          }}
        >
          <span className={styles.eyebrow}>YOU ARE INVITED</span>
          <h2>Join the movie night.</h2>
          {invite ? (
            <>
              <label htmlFor="guest-name">Your name</label>
              <input
                id="guest-name"
                maxLength={40}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button className={styles.primary} disabled={busy || !name.trim()}>
                Join private room <LuArrowRight aria-hidden="true" />
              </button>
            </>
          ) : (
            <p>A valid invitation is required. Ask the host for a new link.</p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </form>
      </main>
    );
  const host = snapshot.role === 'host';
  const ready = !!snapshot.video?.ready;
  const processing = !!snapshot.video?.processing;
  const failed = !!snapshot.video?.failed;
  const inviteUrl = snapshot.invite ? `${origin}/room/${id}#invite=${snapshot.invite}` : '';
  return (
    <main className={styles.room}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <span className={styles.logo}>M</span> mahoura<span className={styles.accent}>.</span>
        </Link>
        <div className={styles.status}>
          <i className={connected ? styles.online : styles.offline} />
          {connected ? 'Live room' : 'Reconnecting…'}
        </div>
        {host && (
          <button
            className={styles.secondary}
            onClick={() => {
              void closeRoom();
            }}
          >
            <LuLogOut aria-hidden="true" /> End room
          </button>
        )}
      </header>
      <section className={styles.roomTitle}>
        <div>
          <span className={styles.eyebrow}>YOUR LITTLE CINEMA</span>
          <h1>
            {snapshot.hostName} & {snapshot.guestName ?? 'your favorite person'}
          </h1>
        </div>
        <span className={styles.role}>
          {host ? 'Host · You control playback' : 'Guest · Following host'}
        </span>
      </section>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.roomGrid}>
        <section className={styles.cinema}>
          <div className={styles.screen}>
            {ready ? (
              <video
                key={snapshot.video?.version}
                ref={video}
                src={`${path}/video?v=${snapshot.video?.version ?? 0}`}
                playsInline
                preload="metadata"
                onLoadedMetadata={() => {
                  const element = video.current;
                  if (!element) return;
                  element.volume = volume;
                  setDuration(element.duration);
                  setPosition(element.currentTime);
                  setSeek(null);
                  setBlocked(false);
                  synchronize();
                }}
                onTimeUpdate={() => setPosition(video.current?.currentTime ?? 0)}
                onEnded={() => {
                  if (host) void control(false, undefined, true);
                }}
                onError={() =>
                  setError('Video cannot be played. Use browser-compatible H.264/AAC MP4 or WebM.')
                }
              />
            ) : (
              <div className={styles.empty}>
                <LuFilm className={styles.screenIcon} aria-hidden="true" />
                <h2>
                  {uploading
                    ? 'Uploading your film…'
                    : failed
                      ? 'Could not prepare this film'
                      : processing
                        ? 'Preparing your MKV…'
                        : snapshot.video
                          ? 'Waiting for the rest of the upload'
                          : 'The screen is yours.'}
                </h2>
                <p>
                  {failed
                    ? 'Choose a different video or a compatible MP4.'
                    : processing
                      ? 'Upload complete. Converting to a browser-friendly MP4; keep the server running.'
                      : host
                        ? 'Upload an MP4, WebM or MKV (up to 5 GiB).'
                        : 'Waiting for the host to upload a film.'}
                </p>
                {host && !uploading && !processing && (
                  <label className={styles.primary}>
                    <LuUpload aria-hidden="true" />
                    {failed
                      ? 'Choose another film'
                      : snapshot.video
                        ? 'Resume same file'
                        : 'Choose a video'}
                    <input
                      disabled={uploading || busy || !connected}
                      type="file"
                      accept=".mp4,.webm,.mkv,video/mp4,video/webm,video/x-matroska"
                      className={styles.fileInput}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void upload(file);
                        event.target.value = '';
                      }}
                    />
                  </label>
                )}
                {(uploading || snapshot.video) && !processing && !failed && (
                  <div className={styles.progress}>
                    <progress
                      value={
                        uploading
                          ? progress
                          : (snapshot.video?.uploaded ?? 0) / (snapshot.video?.size || 1)
                      }
                      max={1}
                    />
                    <small>
                      {Math.round(
                        100 *
                          (uploading
                            ? progress
                            : (snapshot.video?.uploaded ?? 0) / (snapshot.video?.size || 1)),
                      )}
                      % uploaded
                    </small>
                  </div>
                )}
              </div>
            )}
            {blocked && ready && (
              <button className={styles.unlock} onClick={unlock}>
                <LuVolume2 aria-hidden="true" /> Enable playback / sound
              </button>
            )}
            <div className={styles.floating} aria-live="off">
              {snapshot.reactions.map((reaction) => (
                <span key={reaction.id} className={styles.floatEmoji}>
                  {reaction.content}
                </span>
              ))}
            </div>
          </div>
          {ready && (
            <div className={styles.controls}>
              {host ? (
                <button
                  className={styles.primary}
                  disabled={busy || !connected}
                  onClick={() => {
                    void control(!snapshot.playback.playing, video.current?.ended ? 0 : undefined);
                  }}
                >
                  {snapshot.playback.playing ? (
                    <>
                      <LuPause aria-hidden="true" /> Pause
                    </>
                  ) : (
                    <>
                      <LuPlay aria-hidden="true" /> Play
                    </>
                  )}
                </button>
              ) : (
                <button className={styles.secondary} onClick={unlock}>
                  <LuPlay aria-hidden="true" /> Enable playback
                </button>
              )}
              <span className={styles.time}>
                {clock(position)} / {clock(duration)}
              </span>
              {host ? (
                <>
                  <input
                    aria-label="Seek position"
                    type="range"
                    min={0}
                    max={Number.isFinite(duration) ? duration : 0}
                    step={0.1}
                    value={seek ?? position}
                    onChange={(event) => setSeek(Number(event.target.value))}
                  />
                  <button
                    className={styles.secondary}
                    disabled={seek === null || busy || !connected}
                    onClick={() => {
                      if (seek !== null) void control(snapshot.playback.playing, seek);
                    }}
                  >
                    Seek
                  </button>
                </>
              ) : (
                <progress aria-label="Playback progress" value={position} max={duration || 1} />
              )}
              <label className={styles.volume}>
                <LuVolume2 aria-hidden="true" />
                <input
                  aria-label="Volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setVolume(value);
                    if (video.current) video.current.volume = value;
                  }}
                />
              </label>
              <button
                className={styles.secondary}
                aria-label="Fullscreen"
                onClick={() => {
                  const element = video.current;
                  if (element?.requestFullscreen)
                    void element
                      .requestFullscreen()
                      .catch(() => setError('Fullscreen is unavailable.'));
                  else setError('Fullscreen is unavailable.');
                }}
              >
                <LuMaximize aria-hidden="true" />
              </button>
            </div>
          )}
          <div className={styles.filmInfo}>
            <div>
              <span className={styles.eyebrow}>NOW SHOWING</span>
              <h2>{snapshot.video?.name ?? 'No film selected'}</h2>
              {snapshot.video?.completed && !host && (
                <small className={styles.nextFilmHint}>
                  The film has ended. Waiting for the next one…
                </small>
              )}
            </div>
            {snapshot.video?.completed ? (
              host ? (
                <label className={styles.primary}>
                  <LuUpload aria-hidden="true" /> Choose next film
                  <input
                    disabled={uploading || busy || !connected}
                    type="file"
                    accept=".mp4,.webm,.mkv,video/mp4,video/webm,video/x-matroska"
                    className={styles.fileInput}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(file);
                      event.target.value = '';
                    }}
                  />
                </label>
              ) : (
                <span>Finished</span>
              )
            ) : (
              <span>{snapshot.playback.playing ? 'Playing' : 'Paused'}</span>
            )}
          </div>
          {host && snapshot.invite && (
            <div className={styles.invitation}>
              <div>
                <strong>Invite your person</strong>
                <small>Keep this link private — it can be redeemed by one guest.</small>
              </div>
              <input
                aria-label="Invitation link"
                value={inviteUrl}
                readOnly
                onFocus={(event) => event.target.select()}
              />
              <button
                className={styles.primary}
                onClick={() => {
                  void copyInvite();
                }}
              >
                {copied ? <LuCheck aria-hidden="true" /> : <LuCopy aria-hidden="true" />}
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
          )}
        </section>
        <aside className={styles.chat}>
          <header>
            <span className={styles.eyebrow}>TOGETHER IN THE MOMENT</span>
            <h2>Room chat</h2>
            <small>
              {snapshot.guestName
                ? `${snapshot.hostName} · ${snapshot.guestName}`
                : 'Waiting for your guest'}
            </small>
          </header>
          <div className={styles.messages} role="log" aria-live="polite">
            {snapshot.chat.length ? (
              snapshot.chat.map((event) => (
                <article
                  key={event.id}
                  className={event.role === snapshot.role ? styles.mine : styles.theirs}
                >
                  <small>{event.role === 'host' ? snapshot.hostName : snapshot.guestName}</small>
                  <p>{event.content}</p>
                </article>
              ))
            ) : (
              <p className={styles.muted}>Say something sweet. This space is just for you two.</p>
            )}
            {otherTyping && (
              <div className={styles.typing} role="status" aria-live="polite">
                <span>{otherName} is typing…</span>
                <span className={styles.typingDots} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
            <div ref={chatEnd} />
          </div>
          <div className={styles.reactions}>
            {emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Send ${emoji} reaction`}
                disabled={!connected}
                onClick={() => {
                  void send('reaction', emoji);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              if (message.trim()) void send('chat', message);
            }}
          >
            <input
              aria-label="Chat message"
              placeholder="Write a message…"
              maxLength={500}
              value={message}
              onChange={(event) => {
                const value = event.target.value;
                setMessage(value);
                updateTyping(value);
              }}
              onBlur={stopTyping}
            />
            <button className={styles.primary} disabled={!connected || !message.trim()}>
              <LuSend aria-hidden="true" /> Send
            </button>
          </form>
        </aside>
      </div>
      <footer className={styles.footer}>
        Private by invitation · Room expires {new Date(snapshot.expiresAt).toLocaleString()} · Use
        only media you have permission to share.
      </footer>
    </main>
  );
}
