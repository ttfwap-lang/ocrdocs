/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Without this, an uncaught error anywhere in the tree (e.g. the effect bug
 * that used to crash the Copilot tab) unmounts the entire app to a blank
 * screen, including the navbar -- there was no way back to a working tab
 * short of a full page reload. This catches it, keeps the navbar/status bar
 * usable, and shows the real error rather than silently failing.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  resetKey: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // This project has no @types/react installed (every other component is a
  // function component, so it's never come up) -- React.Component resolves
  // as untyped, so inherited members like `props`/`setState` don't type-check
  // unless redeclared here. `declare` emits no runtime code; React's own
  // constructor still assigns the real `this.props`.
  declare readonly props: Readonly<ErrorBoundaryProps>;
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled error in tab content:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      // setState is inherited from the (untyped, see above) React.Component base.
      (this as unknown as { setState: (s: ErrorBoundaryState) => void }).setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-8 neon-card rounded-xl flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="w-8 h-8 text-rose-400" />
          <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-rose-300">This tab hit an error</h2>
          <p className="text-xs font-mono text-slate-500 max-w-lg">{this.state.error.message}</p>
          <p className="text-[10px] font-mono text-slate-600">Switch tabs above to keep working -- this didn't take down the rest of the app.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
