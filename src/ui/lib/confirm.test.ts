import { askConfirm, inPageConfirm } from './confirm';

afterEach(() => vi.restoreAllMocks());

test('askConfirm uses window.confirm outside the artifact build', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  await expect(askConfirm('Sure?')).resolves.toBe(true);
  expect(confirm).toHaveBeenCalledWith('Sure?');
});

test('inPageConfirm resolves with the button tapped and removes itself', async () => {
  const yes = inPageConfirm('Replace?', 'Replace');
  (document.querySelector('.sheet .btn-primary') as HTMLButtonElement).click();
  await expect(yes).resolves.toBe(true);
  expect(document.querySelector('.sheet')).toBeNull();
  const no = inPageConfirm('Replace?');
  (document.querySelector('.sheet .btn-ghost') as HTMLButtonElement).click();
  await expect(no).resolves.toBe(false);
});
