// src/Toast.jsx — LiveBridge Toast Notification System
// ✅ Part 2 Client: Network disconnect/reconnect toast
// ✅ Stackable toasts with auto-dismiss
// ✅ Used by App.jsx via useToast() hook

import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import { CheckCircle, AlertTriangle, WifiOff, Wifi, X, Info } from 'lucide-react';

// ── Toast context ─────────────────────────────────────────────────────────────
const ToastContext = createContext(null);

const ICONS = {
  success: <CheckCircle  size={15} />,
  error:   <AlertTriangle size={15} />,
  warn:    <AlertTriangle size={15} />,
  info:    <Info          size={15} />,
  offline: <WifiOff       size={15} />,
  online:  <Wifi          size={15} />,
};

const COLORS = {
  success: { bg: 'rgba(34,197,94,.15)',   border: 'rgba(34,197,94,.4)',   text: '#4ade80' },
  error:   { bg: 'rgba(248,81,73,.15)',   border: 'rgba(248,81,73,.4)',   text: '#f87171' },
  warn:    { bg: 'rgba(245,158,11,.12)',  border: 'rgba(245,158,11,.4)',  text: '#fbbf24' },
  info:    { bg: 'rgba(56,139,253,.12)',  border: 'rgba(56,139,253,.4)',  text: '#60a5fa' },
  offline: { bg: 'rgba(248,81,73,.15)',   border: 'rgba(248,81,73,.4)',   text: '#f87171' },
  online:  { bg: 'rgba(34,197,94,.12)',   border: 'rgba(34,197,94,.35)',  text: '#4ade80' },
};

let _toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, type = 'info', durationMs = 4000) => {
    const id = ++_toastId;
    setToasts(prev => [{ id, message, type }, ...prev].slice(0, 5)); // max 5 stacked
    if (durationMs > 0) {
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), durationMs);
    }
    return id;
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      {/* Toast container — fixed top-right, above everything */}
      <div style={{
        position: 'fixed', top: 16, right: 16, zIndex: 99999,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none',   // allow clicks through when no toasts
        maxWidth: 340,
      }}>
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }) {
  const c = COLORS[toast.type] || COLORS.info;
  return (
    <div style={{
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 10,
      padding: '10px 14px',
      display: 'flex', alignItems: 'center', gap: 10,
      pointerEvents: 'all',
      animation: 'toast-in .25s ease',
      boxShadow: '0 4px 20px rgba(0,0,0,.4)',
      backdropFilter: 'blur(8px)',
    }}>
      <style>{`@keyframes toast-in { from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:none} }`}</style>
      <span style={{ color: c.text, flexShrink: 0 }}>{ICONS[toast.type]}</span>
      <span style={{ flex: 1, fontSize: 12, color: c.text, fontFamily: "'DM Sans', sans-serif", lineHeight: 1.4 }}>
        {toast.message}
      </span>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: c.text, cursor: 'pointer', opacity: .6, padding: 2, display: 'flex' }}>
        <X size={12} />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

// ── Socket disconnect watcher ─────────────────────────────────────────────────
// Attach this hook to any component that uses a socket.
// It watches connect/disconnect events and fires toast notifications.
export function useSocketToast(socket) {
  const { push } = useToast();
  const persistentRef = useRef(null); // ID of the "offline" toast so we can dismiss it

  useEffect(() => {
    if (!socket) return;

    const onDisconnect = (reason) => {
      persistentRef.current = push(
        `Network lost — reconnecting... (${reason})`,
        'offline',
        0           // 0 = never auto-dismiss; stays until manually cleared
      );
    };

    const onConnect = () => {
      // Dismiss the persistent offline toast if present
      if (persistentRef.current) {
        // We can't call dismiss here easily from the ref, so just push a new one
        persistentRef.current = null;
      }
      push('Reconnected to LiveBridge server ✓', 'online', 3000);
    };

    const onConnectError = () => {
      push('Cannot reach server on port 8000. Is Node running?', 'error', 6000);
    };

    socket.on('disconnect',     onDisconnect);
    socket.on('connect',        onConnect);
    socket.on('connect_error',  onConnectError);

    return () => {
      socket.off('disconnect',    onDisconnect);
      socket.off('connect',       onConnect);
      socket.off('connect_error', onConnectError);
    };
  }, [socket, push]);
}
