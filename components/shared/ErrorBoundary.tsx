"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  section?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="rounded-[8px] border border-dangerline/40 bg-[#070807]/8 p-6 shadow-panel-edge backdrop-blur-md">
          <div className="flex items-start gap-4">
            <AlertTriangle className="h-6 w-6 shrink-0 text-dangerline" />
            <div className="min-w-0">
              <p className="font-mono text-sm text-dangerline">
                {this.props.section ? `${this.props.section} 加载失败` : "组件加载失败"}
              </p>
              <p className="mt-1 text-xs text-white/42 break-words">
                {this.state.error?.message ?? "未知错误"}
              </p>
              <button
                type="button"
                onClick={this.handleReset}
                className="mt-3 inline-flex items-center gap-2 rounded-[6px] border border-white/10 px-3 py-1.5 font-mono text-xs text-white/58 transition hover:border-acid/50 hover:text-acid"
              >
                <RefreshCw className="h-3 w-3" />
                RETRY
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
