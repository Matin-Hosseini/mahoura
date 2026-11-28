import { PartyTyping, TYPING_TTL_MS } from './party.typing';

describe('Party typing presence', () => {
  const notify = jest.fn();
  const typing = new PartyTyping(notify);

  beforeEach(() => {
    jest.useFakeTimers();
    notify.mockClear();
  });

  afterEach(() => {
    typing.clear();
    jest.useRealTimers();
  });

  it('notifies only on changes and expires after the latest heartbeat', () => {
    typing.set('room', 'host', true);
    expect(typing.snapshot('room')).toEqual({ host: true, guest: false });
    jest.advanceTimersByTime(2000);
    typing.set('room', 'host', true);
    expect(notify).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(TYPING_TTL_MS - 1);
    expect(typing.snapshot('room').host).toBe(true);
    jest.advanceTimersByTime(1);
    expect(typing.snapshot('room').host).toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('clears only the given participant and isolates rooms', () => {
    typing.set('a', 'host', true);
    typing.set('a', 'guest', true);
    typing.set('b', 'guest', true);
    typing.set('a', 'guest', false);
    expect(typing.snapshot('a')).toEqual({ host: true, guest: false });
    expect(typing.snapshot('b')).toEqual({ host: false, guest: true });
    typing.delete('a');
    expect(typing.snapshot('a')).toEqual({ host: false, guest: false });
  });
});
