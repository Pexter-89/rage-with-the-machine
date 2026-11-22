import { IS_ARTIFACT } from '../../env';

/**
 * "OK / Cancel" question. The PWA uses the browser's confirm(); the Claude artifact runs in a sandboxed
 * frame where confirm() may be blocked (it then returns false without asking), so it shows an in-page sheet.
 */
export function askConfirm(message: string, okLabel = 'OK'): Promise<boolean> {
  if (!IS_ARTIFACT) {
    try {
      return Promise.resolve(window.confirm(message));
    } catch {
      return Promise.resolve(false);
    }
  }
  return inPageConfirm(message, okLabel);
}

export function inPageConfirm(message: string, okLabel = 'OK'): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'alertdialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', message);
    const text = document.createElement('p');
    text.textContent = message;
    const row = document.createElement('div');
    row.className = 'nav-row';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.className = 'btn btn-primary';
    ok.textContent = okLabel;
    row.append(cancel, ok);
    sheet.append(text, row);
    backdrop.append(sheet);
    const done = (answer: boolean) => {
      backdrop.remove();
      resolve(answer);
    };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) done(false);
    });
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    document.body.append(backdrop);
    ok.focus();
  });
}
