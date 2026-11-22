import { render, screen } from '@testing-library/react';
import App from '../../app/js/ui/App.js';
import { html } from '../../app/js/lib/html.js';

test('renders app title', () => {
  render(html`<${App} />`);
  expect(screen.getByText('Rage with the machine')).toBeInTheDocument();
});
