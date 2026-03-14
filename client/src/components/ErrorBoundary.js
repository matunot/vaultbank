import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({
      error: error,
      errorInfo: errorInfo
    });

    // Log error to console for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Log critical errors to backend (if it exists later)
    // For now, also log to development console with structured data
    if (process.env.NODE_ENV === 'development') {
      // Could integrate with useLog hook here, but since this is outside React context,
      // we handle it with basic logging that the useLog hook can fallback to
      const errorLogData = {
        event: 'error_component_crash',
        meta: {
          errorMessage: error.toString(),
          componentStack: errorInfo.componentStack,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          url: window.location.href
        }
      };

      console.error('🚨 Component Crash Event:', errorLogData);

      // In production, this would send to logging endpoint
      fetch('/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorLogData),
        keepalive: true // Allow request to complete even if page reloads
      }).catch(logError => {
        console.error('Failed to send crash log:', logError);
      });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
          <div className="max-w-md w-full mx-4">
            <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border-2 border-red-400/50 text-center">
              <div className="mb-6">
                <div className="mx-auto h-20 w-20 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
                  <svg className="h-10 w-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">Oops! Something went wrong</h1>
                <p className="text-purple-200">
                  We're sorry, but something unexpected happened. Please try refreshing the page.
                </p>
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => window.location.reload()}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-105"
                >
                  🔄 Refresh Page
                </button>

                <button
                  onClick={() => window.location.href = '/login'}
                  className="w-full bg-gradient-to-r from-gray-500/20 to-gray-600/20 hover:from-gray-500/30 hover:to-gray-600/30 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-300 border-2 border-gray-400/30"
                >
                  🏠 Go to Login
                </button>
              </div>

              {/* Development error details */}
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="mt-6 text-left">
                  <summary className="text-red-300 cursor-pointer mb-2">Error Details (Development)</summary>
                  <div className="bg-black/20 rounded-lg p-4 text-xs text-red-200 overflow-auto max-h-32">
                    <div className="font-mono">
                      <div><strong>Error:</strong> {this.state.error.toString()}</div>
                      {this.state.errorInfo && (
                        <div className="mt-2">
                          <strong>Component Stack:</strong>
                          <pre className="whitespace-pre-wrap mt-1">{this.state.errorInfo.componentStack}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
