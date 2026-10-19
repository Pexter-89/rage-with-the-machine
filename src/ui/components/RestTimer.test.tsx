import { act, render, screen } from '@testing-library/react';
import RestTimer, { formatRest } from './RestTimer';

test('formatRest shows minutes and zero-padded seconds', () => {
  expect(formatRest(0)).toBe('0:00');
  expect(formatRest(65_400)).toBe('1:05');
  expect(formatRest(600_000)).toBe('10:00');
  expect(formatRest(-5)).toBe('0:00');
});

test('hidden until started, then counts up from the start time', () => {
  vi.useFakeTimers();
  try {
    const { rerender } = render(<RestTimer since={null} />);
    expect(screen.queryByRole('timer')).toBeNull();
    rerender(<RestTimer since={Date.now()} />);
    expect(screen.getByRole('timer')).toHaveTextContent('Rest0:00');
    act(() => vi.advanceTimersByTime(75_000));
    expect(screen.getByRole('timer')).toHaveTextContent('Rest1:15');
    // A new set restarts it.
    rerender(<RestTimer since={Date.now()} />);
    expect(screen.getByRole('timer')).toHaveTextContent('Rest0:00');
  } finally {
    vi.useRealTimers();
  }
});
