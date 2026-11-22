import { askConfirm, inPageConfirm } from '../../../app/js/ui/lib/confirm.js';

afterEach(() => vi.restoreAllMocks());

test('askConfirm asks with the in-page sheet, never window.confirm', async () => {
  const confirm = vi.spyOn(window, 'confirm');
  const answer = askConfirm('Sure?', 'Yes');
  const sheet = document.querySelector('.sheet');
  expect(sheet.getAttribute('aria-label')).toBe('Sure?');
  expect(sheet.querySelector('.btn-primary').textContent).toBe('Yes');
  sheet.querySelector('.btn-primary').click();
  await expect(answer).resolves.toBe(true);
  expect(confirm).not.toHaveBeenCalled();
});

test('inPageConfirm resolves with the button tapped and removes itself', async () => {
  const yes = inPageConfirm('Replace?', 'Replace');
  document.querySelector('.sheet .btn-primary').click();
  await expect(yes).resolves.toBe(true);
  expect(document.querySelector('.sheet')).toBeNull();
  const no = inPageConfirm('Replace?');
  document.querySelector('.sheet .btn-ghost').click();
  await expect(no).resolves.toBe(false);
});
