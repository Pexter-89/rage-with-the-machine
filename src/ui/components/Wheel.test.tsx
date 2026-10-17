import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseWeightInput } from '../../domain/loading';
import Wheel, { indexFromScroll } from './Wheel';

const setup = (value = 62, onChange = vi.fn(), values = [60, 62, 64]) => {
  render(
    <Wheel label="KG" values={values} value={value} onChange={onChange} parse={parseWeightInput} />,
  );
  return { onChange, user: userEvent.setup() };
};

test('shows selected value', () => {
  setup();
  expect(screen.getByRole('button', { name: 'KG 62' })).toHaveTextContent('62');
});

test('typing 62,5 commits 62.5', async () => {
  const { onChange, user } = setup();
  await user.click(screen.getByRole('button', { name: 'KG 62' }));
  const input = screen.getByRole('textbox');
  expect(input).toHaveFocus();
  await user.clear(input);
  await user.type(input, '62,5{Enter}');
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(62.5);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('blur commits the typed value', async () => {
  const { onChange, user } = setup();
  await user.click(screen.getByRole('button', { name: 'KG 62' }));
  const input = screen.getByRole('textbox');
  await user.clear(input);
  await user.type(input, '70');
  await user.tab();
  expect(onChange).toHaveBeenCalledWith(70);
});

test('invalid typed value reverts and does not call onChange', async () => {
  const { onChange, user } = setup();
  await user.click(screen.getByRole('button', { name: 'KG 62' }));
  const input = screen.getByRole('textbox');
  await user.clear(input);
  await user.type(input, 'abc{Enter}');
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'KG 62' })).toBeInTheDocument();
});

test('Escape cancels without calling onChange', async () => {
  const { onChange, user } = setup();
  await user.click(screen.getByRole('button', { name: 'KG 62' }));
  await user.type(screen.getByRole('textbox'), '9{Escape}');
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'KG 62' })).toBeInTheDocument();
});

test('value not in values is displayed', () => {
  setup(61);
  expect(screen.getByRole('button', { name: 'KG 61' })).toBeInTheDocument();
});

test('suffix follows the number', () => {
  render(
    <Wheel label="KG" values={[10]} value={10} onChange={vi.fn()} parse={parseWeightInput} suffix="L" />,
  );
  expect(screen.getByRole('button', { name: 'KG 10' })).toHaveTextContent('10L');
});

test('indexFromScroll rounds and clamps', () => {
  expect(indexFromScroll(66, 44, 3)).toBe(2);
  expect(indexFromScroll(0, 44, 3)).toBe(0);
  expect(indexFromScroll(-10, 44, 3)).toBe(0);
  expect(indexFromScroll(500, 44, 3)).toBe(2);
});

describe('scroll settling', () => {
  const mount = (value: number, onChange = vi.fn()) => {
    render(
      <Wheel label="KG" values={[60, 62, 64]} value={value} onChange={onChange} parse={parseWeightInput} />,
    );
    const el = document.querySelector('.wheel-scroll') as HTMLElement;
    let top = 0;
    Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => (top = v), configurable: true });
    const scrollTo = (row: number) => {
      top = row * 44;
      fireEvent.scroll(el);
    };
    return { el, onChange, scrollTo };
  };
  const hadScrollEnd = 'onscrollend' in window;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    if (!hadScrollEnd) delete (window as unknown as Record<string, unknown>).onscrollend;
  });

  test('scroll to row N then scrollend gives exactly one onChange', () => {
    const { el, onChange, scrollTo } = mount(62);
    scrollTo(2);
    fireEvent(el, new Event('scrollend'));
    vi.advanceTimersByTime(500);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(64);
  });

  test('settling on the displayed off-list value does not call onChange', () => {
    const { el, onChange, scrollTo } = mount(63);
    scrollTo(2); // [60, 62, 63, 64]
    fireEvent(el, new Event('scrollend'));
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('while the pointer is down, the debounce does not call onChange', () => {
    const { el, onChange, scrollTo } = mount(62);
    fireEvent.pointerDown(el);
    scrollTo(2);
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(el);
    vi.advanceTimersByTime(500);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(64);
  });

  test('without scrollend support it settles after 120 ms', () => {
    delete (window as unknown as Record<string, unknown>).onscrollend;
    const { onChange, scrollTo } = mount(62);
    scrollTo(0);
    vi.advanceTimersByTime(119);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(60);
  });

  test('with scrollend support, a paused drag does not settle on the debounce', () => {
    Object.defineProperty(window, 'onscrollend', { value: null, configurable: true });
    const { onChange, scrollTo } = mount(62);
    scrollTo(2);
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });
});
