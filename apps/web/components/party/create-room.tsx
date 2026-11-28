'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LuArrowRight, LuFilm, LuHeart, LuRefreshCw } from 'react-icons/lu';
import { api } from './protocol';
import styles from './party.module.css';

export function CreateRoom() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { id } = await api<{ id: string }>('/api/party/rooms', 'POST', { name });
      router.push(`/room/${id}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not create room.');
      setBusy(false);
    }
  }
  return (
    <main className={styles.landing}>
      <header className={styles.brand}>
        <span className={styles.logo}>M</span> mahoura<span className={styles.accent}>.</span>
      </header>
      <section className={styles.hero}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>PRIVATE MOVIE NIGHTS</span>
          <h1>
            Different places.
            <br />
            <span>One little cinema.</span>
          </h1>
          <p>
            Pick a film, invite your favorite person, and share the moment. Every play, pause, laugh
            and heart, together.
          </p>
          <div className={styles.features}>
            <span>
              <LuFilm aria-hidden="true" /> Your own video
            </span>
            <span>
              <LuRefreshCw aria-hidden="true" /> Synchronized playback
            </span>
            <span>
              <LuHeart aria-hidden="true" /> Live chat & reactions
            </span>
          </div>
        </div>
        <form
          className={styles.createCard}
          onSubmit={(event) => {
            void create(event);
          }}
        >
          <span className={styles.eyebrow}>YOUR PRIVATE ROOM</span>
          <h2>Make a night of it.</h2>
          <label htmlFor="host-name">Your name</label>
          <input
            id="host-name"
            autoComplete="nickname"
            maxLength={40}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="What should we call you?"
          />
          <button className={styles.primary} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create a room'}
            {!busy && <LuArrowRight aria-hidden="true" />}
          </button>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <small>Invite-only access · Rooms expire after 24 hours</small>
        </form>
      </section>
    </main>
  );
}
