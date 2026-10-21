import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Protect React 19 reconciler against browser extensions & Chrome Google Translate DOM mutations
if (typeof Node === 'function' && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      return child;
    }
    return originalRemoveChild.apply(this, [child]) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(
    newNode: T,
    referenceNode: Node | null
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      return newNode;
    }
    return originalInsertBefore.apply(this, [newNode, referenceNode]) as T;
  };
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error?.message || 'Unexpected render error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#090D16] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#0B101B] border border-cyan-500/40 rounded-lg p-6 text-center space-y-4">
            <h1 className="text-lg font-bold text-cyan-400">HyperQuant 3D Desk — Recovery Mode</h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              A browser extension or page translator interrupted the WebGL/DOM render cycle ({this.state.errorMsg}).
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMsg: '' });
                window.location.reload();
              }}
              className="px-4 py-2 bg-cyan-500 text-slate-950 text-xs font-semibold rounded-md hover:bg-cyan-400 transition-colors"
            >
              Reload Terminal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);

