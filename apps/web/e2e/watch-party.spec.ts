import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Run from apps/web. The synthetic purple clip is not a real movie.
const base = 'http://localhost:3000';
const clip = Buffer.from(
  readFileSync(resolve(process.cwd(), 'e2e/fixtures/sample.webm.b64'), 'utf8'),
  'base64',
);

test('two browsers watch, pause, chat and react together', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await host.goto(base);
    await host.getByLabel('Your name').fill('Host');
    await host.getByRole('button', { name: 'Create a room' }).click();
    await expect(host.getByText('Live room')).toBeVisible();
    const link = await host.getByLabel('Invitation link').inputValue();
    await guest.goto(link);
    await guest.getByLabel('Your name').fill('Guest');
    await guest.getByRole('button', { name: 'Join private room' }).click();
    await expect(guest.getByText('Live room')).toBeVisible();
    await host
      .locator('input[type=file]')
      .setInputFiles({ name: 'sample.webm', mimeType: 'video/webm', buffer: clip });
    await expect(host.locator('video')).toBeVisible();
    await expect(guest.locator('video')).toBeVisible();
    await guest.getByRole('button', { name: 'Enable playback', exact: true }).click();
    await host.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(() => guest.locator('video').evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(false);
    await expect
      .poll(async () => {
        const times = await Promise.all(
          [host, guest].map((page) =>
            page.locator('video').evaluate((element: HTMLVideoElement) => element.currentTime),
          ),
        );
        return Math.abs((times[0] ?? 0) - (times[1] ?? 0));
      })
      .toBeLessThan(2);
    await host.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect
      .poll(() => guest.locator('video').evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(true);
    await guest.getByLabel('Chat message').fill('Watching together!');
    await expect(host.getByText('Guest is typing…')).toBeVisible();
    await guest.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(host.getByText('Watching together!')).toBeVisible();
    await expect(host.getByText('Guest is typing…')).not.toBeVisible();
    await host.getByRole('button', { name: 'Send ❤️ reaction' }).click();
    await expect(guest.locator('span').filter({ hasText: /^❤️$/ })).toBeVisible();
    await guest.reload();
    await expect(guest.getByText('Live room')).toBeVisible();
    await expect(guest.getByText('Watching together!')).toBeVisible();
    const firstSource = await host.locator('video').getAttribute('src');
    await host.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(host.getByText('Choose next film')).toBeVisible({ timeout: 20_000 });
    await host.locator('input[type=file]').setInputFiles({
      name: 'second.webm',
      mimeType: 'video/webm',
      buffer: clip,
    });
    await expect(guest.getByRole('heading', { name: 'second.webm' })).toBeVisible();
    await expect(guest.locator('video')).not.toHaveAttribute('src', firstSource ?? '');
    await expect(host.locator('video')).toBeVisible();
    await expect(guest.getByText('Watching together!')).toBeVisible();
  } finally {
    // Use the host session to clean up even if an assertion fails.
    const id = /\/room\/([0-9a-f-]+)/.exec(host.url())?.[1];
    if (id)
      await hostContext.request.delete(`${base}/api/party/rooms/${id}`).catch(() => undefined);
    await hostContext.close();
    await guestContext.close();
  }
});
