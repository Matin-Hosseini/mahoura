import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { MAX_VIDEO_BYTES } from './party.protocol';

// A single background job is scheduled by PartyService. Never execute a shell or
// use the client-supplied filename as a path or argument.
export function startMkvConversion(input: string, output: string) {
  const child = spawn(
    'ffmpeg',
    [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-xerror',
      '-y',
      '-protocol_whitelist',
      'file',
      '-threads',
      '2',
      '-f',
      'matroska',
      '-i',
      input,
      '-map',
      '0:V:0',
      '-map',
      '0:a:0?',
      '-filter_threads',
      '1',
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-threads',
      '2',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      '-fs',
      String(MAX_VIDEO_BYTES),
      '-f',
      'mp4',
      output,
    ],
    { stdio: 'ignore' },
  );
  const done = new Promise<boolean>((resolve) => {
    let failed = false;
    child.once('error', () => {
      failed = true;
    });
    child.once('close', (code) => resolve(!failed && code === 0));
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 6 * 60 * 60_000);
  timeout.unref();
  const result = done.then(async (success) => {
    clearTimeout(timeout);
    if (!success) return false;
    const { size } = await stat(output);
    // FFmpeg can exit successfully after hitting -fs. Reject files near the cap
    // rather than publishing a potentially truncated movie.
    return size > 0 && size < MAX_VIDEO_BYTES - 16 * 1024 ** 2;
  });
  return {
    result,
    stop: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      return done;
    },
  };
}
