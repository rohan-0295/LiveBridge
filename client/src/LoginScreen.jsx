// src/LoginScreen.jsx
import { useState } from 'react';
import { useAuth } from './AuthContext';
import { Phone, Lock, User, ChevronRight, AlertCircle } from 'lucide-react';

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

export default function LoginScreen() {
  const { login, register, loading, error } = useAuth();
  const [mode,  setMode]  = useState('login'); // 'login' | 'register'
  const [form,  setForm]  = useState({ name: '', phone_number: '', password: '' });
  const [localErr, setLocalErr] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    setLocalErr('');
    if (mode === 'register') {
      if (!form.name.trim())           return setLocalErr('Please enter your name.');
      if (form.phone_number.length < 7) return setLocalErr('Enter a valid phone number.');
      if (form.password.length < 6)    return setLocalErr('Password must be at least 6 characters.');
      const res = await register(form);
      if (!res.ok) setLocalErr(res.error);
    } else {
      if (!form.phone_number) return setLocalErr('Enter your phone number.');
      if (!form.password)     return setLocalErr('Enter your password.');
      const res = await login({ phone_number: form.phone_number, password: form.password });
      if (!res.ok) setLocalErr(res.error);
    }
  };

  const err = localErr || error;

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px 24px 32px', animation: 'lb-fadein .25s ease',
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 28, textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: T.redDim, border: `2px solid ${T.red}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 12px',
        }}>
          <span style={{ fontFamily: T.font, fontWeight: 800, fontSize: 18, color: T.red }}>SOS</span>
        </div>
        <h1 style={{ fontFamily: T.font, fontWeight: 800, fontSize: 20, color: T.text1, margin: '0 0 4px', letterSpacing: 2 }}>
          LIVEBRIDGE
        </h1>
        <p style={{ fontSize: 11, color: T.text3, margin: 0, letterSpacing: 1.5 }}>EMERGENCY RESPONSE</p>
      </div>

      {/* Mode toggle */}
      <div style={{
        display: 'flex', background: T.bg2, border: `1px solid ${T.border}`,
        borderRadius: 10, padding: 3, marginBottom: 24, width: '100%',
      }}>
        {['login', 'register'].map(m => (
          <button key={m} onClick={() => { setMode(m); setLocalErr(''); }} style={{
            flex: 1, padding: '8px 0',
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

      {/* Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
        {mode === 'register' && (
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: T.text3, fontFamily: T.font, display: 'block', marginBottom: 6 }}>
              FULL NAME
            </label>
            <div style={{ position: 'relative' }}>
              <User size={14} color={T.text3} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Your full name"
                style={{ ...inputStyle, paddingLeft: 34 }}
              />
            </div>
          </div>
        )}

        <div>
          <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: T.text3, fontFamily: T.font, display: 'block', marginBottom: 6 }}>
            PHONE NUMBER
          </label>
          <div style={{ position: 'relative' }}>
            <Phone size={14} color={T.text3} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              value={form.phone_number}
              onChange={e => set('phone_number', e.target.value)}
              placeholder="+91 98765 43210"
              type="tel"
              style={{ ...inputStyle, paddingLeft: 34 }}
            />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: T.text3, fontFamily: T.font, display: 'block', marginBottom: 6 }}>
            PASSWORD
          </label>
          <div style={{ position: 'relative' }}>
            <Lock size={14} color={T.text3} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              value={form.password}
              onChange={e => set('password', e.target.value)}
              placeholder={mode === 'register' ? 'Min. 6 characters' : 'Your password'}
              type="password"
              style={{ ...inputStyle, paddingLeft: 34 }}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
        </div>

        {/* Error */}
        {err && (
          <div style={{
            background: T.redDim, border: `1px solid ${T.red}44`,
            borderRadius: 8, padding: '9px 12px',
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <AlertCircle size={13} color={T.red} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#f87171', fontFamily: T.body }}>{err}</span>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            width: '100%', padding: 13,
            background: loading ? T.bg2 : T.red,
            border: `1px solid ${loading ? T.border : T.red}`,
            borderRadius: 12, color: loading ? T.text3 : '#fff',
            fontFamily: T.font, fontWeight: 800, fontSize: 12, letterSpacing: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: loading ? 'not-allowed' : 'pointer', transition: 'all .15s',
            marginTop: 4,
          }}
        >
          {loading
            ? <><div style={{ width: 14, height: 14, border: '2px solid #44444444', borderTopColor: T.text3, borderRadius: '50%', animation: 'lb-spin .8s linear infinite' }} /> Processing...</>
            : <>{mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'} <ChevronRight size={14} /></>
          }
        </button>
      </div>

      <p style={{ fontSize: 11, color: T.text3, textAlign: 'center', marginTop: 20, lineHeight: 1.6, fontFamily: T.body }}>
        Your account keeps your medical data<br />secure and tied to your SOS profile.
      </p>
    </div>
  );
}
