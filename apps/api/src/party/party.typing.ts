import type { Role } from './party.protocol';

// Ephemeral presence; a lost connection cannot leave a permanent indicator.
export const TYPING_TTL_MS = 4000;
type Entry = ReturnType<typeof setTimeout>;

export class PartyTyping {
  private readonly rooms = new Map<string, Partial<Record<Role, Entry>>>();

  constructor(private readonly notify: (id: string) => void) {}

  snapshot(id: string) {
    const room = this.rooms.get(id);
    return { host: !!room?.host, guest: !!room?.guest };
  }

  set(id: string, role: Role, typing: boolean) {
    const room = this.rooms.get(id) ?? {};
    const previous = room[role];
    clearTimeout(previous);
    if (typing) {
      const timer = setTimeout(() => this.set(id, role, false), TYPING_TTL_MS);
      timer.unref();
      room[role] = timer;
      this.rooms.set(id, room);
    } else {
      delete room[role];
      if (!room.host && !room.guest) this.rooms.delete(id);
    }
    if (!!previous !== typing) this.notify(id);
  }

  delete(id: string) {
    const room = this.rooms.get(id);
    clearTimeout(room?.host);
    clearTimeout(room?.guest);
    this.rooms.delete(id);
  }

  clear() {
    for (const id of this.rooms.keys()) this.delete(id);
  }
}
