import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'An unexpected error occurred.';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed?.error) {
        readable = `Firestore ${parsed.operationType || 'operation'} failed (${parsed.path || 'unknown path'}): ${parsed.error}`;
      }
    } catch {
      // keep original message
    }
    return { hasError: true, message: readable };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050A14] text-slate-100 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#0B1426] border border-rose-500/40 rounded-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-rose-500/15 border border-rose-500/35 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-100 font-display">
                  FinSight Workspace Error
                </h2>
                <p className="text-xs text-slate-400">
                  A database or runtime error interrupted this view.
                </p>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[#081020] border border-[#1E2E4E] text-xs font-mono text-rose-300 break-words">
              {this.state.message}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-500 rounded-lg transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reload Workspace
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
