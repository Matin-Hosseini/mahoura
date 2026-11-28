import {
  digest,
  integer,
  inviteFor,
  playback,
  text,
  token,
  validId,
  validToken,
} from './party.protocol';

describe('Party protocol', () => {
  it('creates distinct, URL-safe capabilities and domain-separated invitations', () => {
    const host = token();
    const invite = inviteFor(host);
    expect(validToken(host)).toBe(true);
    expect(validToken(invite)).toBe(true);
    expect(invite).not.toBe(host);
    expect(inviteFor(host)).toBe(invite);
    expect(digest(host)).not.toBe(digest(invite));
    expect(token()).not.toBe(host);
    expect(validToken('../secret')).toBe(false);
    expect(validId('../secret')).toBe(false);
  });
  it('rejects invalid positions and playback commands', () => {
    expect(playback(12.5, true)).toEqual({ position: 12.5, playing: true });
    for (const value of [-1, Infinity, NaN, '3', 86401])
      expect(() => playback(value, true)).toThrow();
    expect(() => playback(0, 'true')).toThrow();
  });
  it('bounds untrusted text and offsets', () => {
    expect(text(' hello ', 5)).toBe('hello');
    expect(() => text(' ', 5)).toThrow();
    expect(() => text('abcdef', 5)).toThrow();
    expect(() => integer(1.5, 0, 10)).toThrow();
    expect(() => integer(-1, 0, 10)).toThrow();
    expect(integer(10, 0, 10)).toBe(10);
  });
});
