// src/LoginScreen.jsx
// Modes: 'login' | 'register' | 'forgot' | 'reset'

import { useState } from 'react';
import { useAuth } from './AuthContext';
import { Phone, Lock, User, ChevronRight, AlertCircle, ArrowLeft, CheckCircle, KeyRound, RefreshCw } from 'lucide-react';

const T = {
  bg0: '#080808', bg1: '#111111', bg2: '#1a1a1a', bg3: '#222222',
  border: '#242424', text1: '#e8e8e8', text2: '#888888', text3: '#444444',
  red: '#ef4444', redDim: '#7f1d1d',
  green: '#22c55e', greenDim: '#166534',
  blue: '#3b82f6', blueDim: '#1e3a5f',
  amber: '#f59e0b',
  font: "'Syne', sans-serif",
  body: "'DM Sans', sans-serif",
};

const inputStyle = {
  width: '100%', padding: '11px 14px',
  background: T.bg2, border: `1px solid ${T.border}`,
  borderRadius: 10, color: T.text1,
  fontFamily: T.body, fontSize: 13,
  outline: 'none', boxSizing: 'border-box',
};

const API = 'http://localhost:8000';

export default function LoginScreen() {
  const { login, register, loading, error } = useAuth();

  // mode: 'login' | 'register' | 'forgot' | 'reset'
  const [mode,     setMode]     = useState('login');
  const [form,     setForm]     = useState({ name: '', phone_number: '', password: '', otp: '', new_password: '' });
  const [localErr, setLocalErr] = useState('');
  const [localMsg, setLocalMsg] = useState('');  // success message
  const [busy,     setBusy]     = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const clearStatus = () => { setLocalErr(''); setLocalMsg(''); };

  const switchMode = (m) => { setMode(m); clearStatus(); };

  // ── Submit handlers ──────────────────────────────────────────────────

  const handleLogin = async () => {
    if (!form.phone_number) return setLocalErr('Enter your phone number.');
    if (!form.password)     return setLocalErr('Enter your password.');
    const res = await login({ phone_number: form.phone_number, password: form.password });
    if (!res.ok) setLocalErr(res.error);
  };

  const handleRegister = async () => {
    if (!form.name.trim())           return setLocalErr('Please enter your name.');
    if (form.phone_number.length < 7) return setLocalErr('Enter a valid phone number.');
    if (form.password.length < 6)    return setLocalErr('Password must be at least 6 characters.');
    const res = await register(form);
    if (!res.ok) setLocalErr(res.error);
  };

  // Step 1 of forgot: request OTP
  const handleForgotRequest = async () => {
    if (form.phone_number.length < 7) return setLocalErr('Enter a valid phone number.');
    setBusy(true); clearStatus();
    try {
      const res  = await fetch(`${API}/api/auth/forgot-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone_number: form.phone_number }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed.');
      setLocalMsg(data.message || 'OTP sent! Check your registered phone.');
      setMode('reset');
    } catch (err) {
      setLocalErr(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Step 2 of forgot: verify OTP + set new password
  const handleResetPassword = async () => {
    if (!form.otp || form.otp.length < 4)       return setLocalErr('Enter the OTP you received.');
    if (form.new_password.length < 6)            return setLocalErr('New password must be at least 6 characters.');
    setBusy(true); clearStatus();
    try {
      const res  = await fetch(`${API}/api/auth/reset-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          phone_number: form.phone_number,
          otp:          form.otp.trim(),
          new_password: form.new_password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed.');
      setLocalMsg('Password updated! Please sign in.');
      setTimeout(() => { switchMode('login'); }, 1800);
    } catch (err) {
      setLocalErr(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = () => {
    clearStatus();
    if (mode === 'login')    return handleLogin();
    if (mode === 'register') return handleRegister();
    if (mode === 'forgot')   return handleForgotRequest();
    if (mode === 'reset')    return handleResetPassword();
  };

  const isLoading = loading || busy;
  const err       = localErr || (!localMsg ? error : '');

  // ── Mode metadata ─────────────────────────────────────────────────────
  const META = {
    login:    { title: 'Welcome back',         subtitle: 'Sign in to your LiveBridge account',           btn: 'SIGN IN' },
    register: { title: 'Create account',        subtitle: 'Join LiveBridge emergency response',           btn: 'CREATE ACCOUNT' },
    forgot:   { title: 'Forgot password?',      subtitle: 'Enter your phone and we\'ll send you an OTP', btn: 'SEND OTP' },
    reset:    { title: 'Reset password',        subtitle: 'Enter the OTP and your new password',          btn: 'SET NEW PASSWORD' },
  };
  const meta = META[mode];

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '20px 24px 28px',
      animation: 'lb-fadein .25s ease',
      overflowY: 'auto',
    }}>

      {/* Logo */}
      <div style={{ marginBottom: 22, textAlign: 'center' }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: T.redDim, border: `2px solid ${T.red}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 10px',
        }}>
          <span style={{ fontFamily: T.font, fontWeight: 800, fontSize: 17, color: T.red }}>SOS</span>
        </div>
        <h1 style={{ fontFamily: T.font, fontWeight: 800, fontSize: 18, color: T.text1, margin: '0 0 2px', letterSpacing: 2 }}>
          LIVEBRIDGE
        </h1>
        <p style={{ fontSize: 10, color: T.text3, margin: 0, letterSpacing: 1.5 }}>EMERGENCY RESPONSE</p>
      </div>

      {/* Back button — shown in forgot/reset modes */}
      {(mode === 'forgot' || mode === 'reset') && (
        <button
          onClick={() => switchMode('login')}
          style={{
            alignSelf: 'flex-start', marginBottom: 14,
            background: 'none', border: 'none',
            display: 'flex', alignItems: 'center', gap: 6,
            color: T.text3, fontFamily: T.body, fontSize: 12,
            cursor: 'pointer', padding: 0,
          }}
        >
          <ArrowLeft size={13} /> Back to Sign In
        </button>
      )}

      {/* Mode toggle — only for login/register */}
      {(mode === 'login' || mode === 'register') && (
        <div style={{
          display: 'flex', background: T.bg2, border: `1px solid ${T.border}`,
          borderRadius: 10, padding: 3, marginBottom: 20, width: '100%',
        }}>
          {['login', 'register'].map(m => (
            <button key={m} onClick={() => switchMode(m)} style={{
              flex: 1, padding: '7px 0',
              background: mode === m ? T.bg3 : 'transparent',
              border: mode === m ? `1px solid ${T.border}` : '1px solid transparent',
              borderRadius: 8, color: mode === m ? T.text1 : T.text3,
              fontFamily: T.font, fontWeight: 700, fontSize: 11,
              letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer',
              transition: 'all .15s',
            }}>
              {m === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>
      )}

      {/* Section heading (for forgot/reset) */}
      {(mode === 'forgot' || mode === 'reset') && (
        <div style={{ width: '100%', marginBottom: 20 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: T.blueDim, border: `1px solid ${T.blue}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 10,
          }}>
            {mode === 'forgot' ? <KeyRound size={18} color={T.blue} /> : <RefreshCw size={18} color={T.blue} />}
          </div>
          <p style={{ margin: '0 0 2px', fontFamily: T.font, fontWeight: 700, fontSize: 15, color: T.text1 }}>{meta.title}</p>
          <p style={{ margin: 0, fontSize: 11, color: T.text3, fontFamily: T.body }}>{meta.subtitle}</p>
        </div>
      )}

      {/* ── Fields ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>

        {/* Name — register only */}
        {mode === 'register' && (
          <Field label="FULL NAME">
            <IconInput icon={<User size={14} color={T.text3} />}>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="Your full name" style={{ ...inputStyle, paddingLeft: 34 }} />
            </IconInput>
          </Field>
        )}

        {/* Phone — login, register, forgot, reset */}
        {(mode !== 'reset') && (
          <Field label="PHONE NUMBER">
            <IconInput icon={<Phone size={14} color={T.text3} />}>
              <input value={form.phone_number} onChange={e => set('phone_number', e.target.value)}
                placeholder="+91 98765 43210" type="tel"
                style={{ ...inputStyle, paddingLeft: 34 }}
                disabled={mode === 'forgot' && busy}
              />
            </IconInput>
          </Field>
        )}

        {/* Phone display (read-only) on reset step */}
        {mode === 'reset' && (
          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ margin: 0, fontSize: 10, color: T.text3, fontFamily: T.font, letterSpacing: 1.5, marginBottom: 3 }}>OTP SENT TO</p>
            <p style={{ margin: 0, fontSize: 13, color: T.text2, fontFamily: T.body }}>{form.phone_number}</p>
          </div>
        )}

        {/* OTP — reset only */}
        {mode === 'reset' && (
          <Field label="ONE-TIME PASSWORD (OTP)">
            <IconInput icon={<KeyRound size={14} color={T.text3} />}>
              <input value={form.otp} onChange={e => set('otp', e.target.value)}
                placeholder="Enter 6-digit OTP"
                maxLength={6}
                style={{ ...inputStyle, paddingLeft: 34, letterSpacing: 4, fontFamily: 'monospace', fontSize: 16 }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </IconInput>
            {/* Demo hint — remove in production */}
            <p style={{ margin: '5px 0 0', fontSize: 10, color: T.text3, fontFamily: T.body }}>
              💡 Demo: Check your Node.js server terminal for the OTP.
            </p>
          </Field>
        )}

        {/* Password — login, register */}
        {(mode === 'login' || mode === 'register') && (
          <Field label="PASSWORD">
            <IconInput icon={<Lock size={14} color={T.text3} />}>
              <input value={form.password} onChange={e => set('password', e.target.value)}
                placeholder={mode === 'register' ? 'Min. 6 characters' : 'Your password'}
                type="password" style={{ ...inputStyle, paddingLeft: 34 }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </IconInput>
          </Field>
        )}

        {/* New password — reset only */}
        {mode === 'reset' && (
          <Field label="NEW PASSWORD">
            <IconInput icon={<Lock size={14} color={T.text3} />}>
              <input value={form.new_password} onChange={e => set('new_password', e.target.value)}
                placeholder="Min. 6 characters" type="password"
                style={{ ...inputStyle, paddingLeft: 34 }}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </IconInput>
          </Field>
        )}

        {/* Error */}
        {err && (
          <div style={{ background: T.redDim, border: `1px solid ${T.red}44`, borderRadius: 8, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 7 }}>
            <AlertCircle size={13} color={T.red} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#f87171', fontFamily: T.body }}>{err}</span>
          </div>
        )}

        {/* Success message */}
        {localMsg && (
          <div style={{ background: T.greenDim, border: `1px solid ${T.green}44`, borderRadius: 8, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 7 }}>
            <CheckCircle size={13} color={T.green} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#4ade80', fontFamily: T.body }}>{localMsg}</span>
          </div>
        )}

        {/* Primary button */}
        <button
          onClick={handleSubmit}
          disabled={isLoading}
          style={{
            width: '100%', padding: 13,
            background: isLoading ? T.bg2 : T.red,
            border: `1px solid ${isLoading ? T.border : T.red}`,
            borderRadius: 12, color: isLoading ? T.text3 : '#fff',
            fontFamily: T.font, fontWeight: 800, fontSize: 12, letterSpacing: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: isLoading ? 'not-allowed' : 'pointer', transition: 'all .15s',
            marginTop: 4,
          }}
        >
          {isLoading
            ? <><Spinner /> Processing...</>
            : <>{meta.btn} <ChevronRight size={14} /></>
          }
        </button>

        {/* Forgot password link — login mode only */}
        {mode === 'login' && (
          <button
            onClick={() => switchMode('forgot')}
            style={{
              background: 'none', border: 'none',
              color: T.blue, fontSize: 12, fontFamily: T.body,
              cursor: 'pointer', textAlign: 'center', padding: '4px 0',
              textDecoration: 'underline', textDecorationColor: `${T.blue}55`,
            }}
          >
            Forgot your password?
          </button>
        )}

        {/* Resend OTP — reset mode */}
        {mode === 'reset' && (
          <button
            onClick={() => { clearStatus(); switchMode('forgot'); }}
            style={{
              background: 'none', border: 'none',
              color: T.text3, fontSize: 11, fontFamily: T.body,
              cursor: 'pointer', textAlign: 'center', padding: '2px 0',
            }}
          >
            Didn't receive OTP? Go back and try again.
          </button>
        )}
      </div>

      <p style={{ fontSize: 10, color: T.text3, textAlign: 'center', marginTop: 18, lineHeight: 1.6, fontFamily: T.body }}>
        Your account keeps your medical data<br />secure and tied to your SOS profile.
      </p>
    </div>
  );
}

// ── Small helper components ────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: T.text3, fontFamily: T.font, display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function IconInput({ icon, children }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
        {icon}
      </span>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 14, height: 14,
      border: '2px solid #44444444',
      borderTopColor: T.text3,
      borderRadius: '50%',
      animation: 'lb-spin .8s linear infinite',
    }} />
  );
}
