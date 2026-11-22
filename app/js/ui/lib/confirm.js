/**
 * "OK / Cancel" question. The artifact runs in a sandboxed frame where the browser's confirm() may be
 * blocked (it then returns false without asking), so this always shows an in-page sheet.
 * @param {string} message
 * @param {string} [okLabel='OK']
 * @returns {Promise<boolean>}
 */
export function askConfirm(message, okLabel = 'OK') {
  return inPageConfirm(message, okLabel);
}

/**
 * Shows a sheet with the message, Cancel and `okLabel`; resolves true when OK is tapped.
 * @param {string} message
 * @param {string} [okLabel='OK']
 * @returns {Promise<boolean>}
 */
export function inPageConfirm(message, okLabel = 'OK') {
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
    const done = (answer) => {
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
