import { describe, expect, it } from 'vitest';
import { clock, targetPosition, videoType } from './protocol';

describe('Playback synchronization', () => {
  it('projects a playing position using server time', () => {
    expect(targetPosition({ playing: true, position: 30, changedAt: 1000 }, 2500, 120)).toBe(31.5);
  });
  it('keeps a paused position fixed', () => {
    expect(targetPosition({ playing: false, position: 30, changedAt: 1000 }, 60000, 120)).toBe(30);
  });
  it('handles clock skew and clamps to the duration', () => {
    expect(targetPosition({ playing: true, position: 30, changedAt: 2000 }, 1000, 120)).toBe(30);
    expect(targetPosition({ playing: true, position: 119, changedAt: 1000 }, 5000, 120)).toBe(120);
    expect(clock(65.8)).toBe('1:05');
  });
});

describe('Video format selection', () => {
  it('accepts MKV even when the browser does not report a MIME type', () => {
    expect(videoType('movie.MKV')).toBe('video/x-matroska');
    expect(videoType('movie.mp4')).toBe('video/mp4');
    expect(videoType('movie.webm')).toBe('video/webm');
    expect(videoType('movie.mkv.exe')).toBe('');
  });
});
