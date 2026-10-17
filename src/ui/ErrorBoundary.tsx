import { Component, type ReactNode } from 'react';
import { oneLine } from './lib/errors';
import { navigate, type Route } from './router';

interface State {
  error: Error | null;
}

/** Top-level fallback, so a render throw or a storage error never leaves a blank screen. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(e: unknown): State {
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }

  private go(route: Route) {
    navigate(route);
    this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="screen">
        <h1 className="title">Something went wrong</h1>
        <p className="error" role="alert">
          {oneLine(error)}
        </p>
        <p className="hint">Go Home to carry on, or open Settings to export or import a backup.</p>
        <div className="nav-row">
          <button className="btn btn-primary" onClick={() => this.go({ name: 'home' })}>
            Home
          </button>
          <button className="btn btn-ghost" onClick={() => this.go({ name: 'settings' })}>
            Settings
          </button>
        </div>
      </main>
    );
  }
}
