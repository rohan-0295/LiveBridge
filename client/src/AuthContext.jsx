// src/AuthContext.jsx
// Provides { user, token, login, register, logout } to the whole app.
// Token is persisted in localStorage so the user stays logged in on refresh.

import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

const API = 'http://localhost:8000';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('lb_token'));
  const [user,  setUser]  = useState(() => {
    try {
      const raw = localStorage.getItem('lb_user');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // On mount, verify stored token is still valid
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setUser(data);
          localStorage.setItem('lb_user', JSON.stringify(data));
        } else {
          // Token expired or invalid — clear
          logout();
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  function persist(tok, usr) {
    setToken(tok);
    setUser(usr);
    localStorage.setItem('lb_token', tok);
    localStorage.setItem('lb_user',  JSON.stringify(usr));
  }

  async function register({ name, phone_number, password }) {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('http://localhost:8000/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, phone_number, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Registration failed.');
      persist(data.token, data.user);
      return { ok: true };
    } catch (err) {
      setError(err.message);
      return { ok: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }

  async function login({ phone_number, password }) {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone_number, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Login failed.');
      persist(data.token, data.user);
      return { ok: true };
    } catch (err) {
      setError(err.message);
      return { ok: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setToken(null);
    setUser(null);
    localStorage.removeItem('lb_token');
    localStorage.removeItem('lb_user');
  }

  // Authenticated fetch wrapper — automatically attaches Bearer token
  async function authFetch(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, error, login, register, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
