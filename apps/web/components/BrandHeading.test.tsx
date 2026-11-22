import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BrandHeading } from './BrandHeading';

describe('BrandHeading', () => {
  it('renders the product name', () => {
    render(<BrandHeading />);

    expect(
      screen.getByRole('heading', {
        name: 'Mahoura Party',
      }),
    ).toBeInTheDocument();
  });
});
