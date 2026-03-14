import React, { useState, useEffect, createContext, useContext } from "react";

// Toast Context
const ToastContext = createContext();

// Custom hook for using toasts
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};

// Toast types
const TOAST_TYPES = {
  SUCCESS: "success",
  ERROR: "error",
  INFO: "info",
  WARNING: "warning",
};

// Toast Provider component
export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const addToast = (
    message,
    type = TOAST_TYPES.INFO,
    duration = 5000,
    requestId = null
  ) => {
    const id = Date.now() + Math.random();
    const toast = { id, message, type, requestId, duration };
    setToasts((prev) => [...prev, toast]);
    return id;
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  // Auto-remove toasts after duration
  useEffect(() => {
    const intervals = toasts.map((toast) => {
      if (toast.duration > 0) {
        return setTimeout(() => removeToast(toast.id), toast.duration);
      }
      return null;
    });

    return () =>
      intervals.forEach((interval) => interval && clearTimeout(interval));
  }, [toasts]);

  const value = {
    addToast,
    removeToast,
    toasts,
  };

  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
};

function Toast({ toast, onClose }) {
  const { message, type, requestId } = toast;

  const getToastStyles = () => {
    const baseStyles =
      "flex items-center justify-between p-4 rounded-lg shadow-lg border-2 transition-all duration-300 max-w-md";

    switch (type) {
      case TOAST_TYPES.SUCCESS:
        return `${baseStyles} bg-green-500/10 border-green-500/50 text-green-100`;
      case TOAST_TYPES.ERROR:
        return `${baseStyles} bg-red-500/10 border-red-500/50 text-red-100`;
      case TOAST_TYPES.WARNING:
        return `${baseStyles} bg-yellow-500/10 border-yellow-500/50 text-yellow-100`;
      case TOAST_TYPES.INFO:
      default:
        return `${baseStyles} bg-blue-500/10 border-blue-500/50 text-blue-100`;
    }
  };

  const getIcon = () => {
    switch (type) {
      case TOAST_TYPES.SUCCESS:
        return "✅";
      case TOAST_TYPES.ERROR:
        return "❌";
      case TOAST_TYPES.WARNING:
        return "⚠️";
      case TOAST_TYPES.INFO:
      default:
        return "ℹ️";
    }
  };

  return (
    <div className={getToastStyles()}>
      <div className="flex items-center space-x-3 flex-1">
        <span className="text-xl">{getIcon()}</span>
        <div className="flex-1">
          <div className="text-sm leading-tight">{message}</div>
          {requestId && (
            <div className="text-xs opacity-75 mt-1 font-mono">
              Request ID: {requestId}
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        className="ml-4 text-gray-400 hover:text-white transition-colors opacity-75 hover:opacity-100"
        aria-label="Close notification"
      >
        ✕
      </button>
    </div>
  );
}

function NotificationContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-h-screen overflow-y-auto">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          toast={toast}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

// Convenience hooks for different toast types
export const useSuccessToast = () => {
  const { addToast } = useToast();
  return (message, duration, requestId) =>
    addToast(message, TOAST_TYPES.SUCCESS, duration, requestId);
};

export const useErrorToast = () => {
  const { addToast } = useToast();
  return (message, duration, requestId) =>
    addToast(message, TOAST_TYPES.ERROR, duration, requestId);
};

export const useInfoToast = () => {
  const { addToast } = useToast();
  return (message, duration, requestId) =>
    addToast(message, TOAST_TYPES.INFO, duration, requestId);
};

export const useWarningToast = () => {
  const { addToast } = useToast();
  return (message, duration, requestId) =>
    addToast(message, TOAST_TYPES.WARNING, duration, requestId);
};

export default NotificationContainer;
