import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateRoom } from './create-room';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe('CreateRoom', () => {
  it('creates a room with only a name and navigates to it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'room-id' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CreateRoom />);
    const button = screen.getByRole('button', { name: /create a room/i });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Your name'), 'Host');
    expect(screen.queryByLabelText(/host access code/i)).not.toBeInTheDocument();
    await user.click(button);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/party/rooms',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Host' }),
      }),
    );
    expect(push).toHaveBeenCalledWith('/room/room-id');
  });
});
