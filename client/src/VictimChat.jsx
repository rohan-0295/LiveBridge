// src/VictimChat.jsx
// Emergency AI Chat — unlocks after SOS is triggered (Step 3)
// Connects to POST /emergency-chat on the FastAPI ML engine (port 8001)

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Mic, Bot, User, AlertTriangle, Loader } from 'lucide-react';

// ── Design tokens (matches App.jsx) ──────────────────────────────────────
const T = {
  bg0:    '#080808',
  bg1:    '#111111',
  bg2:    '#1a1a1a',
  bg3:    '#222222',
  border: '#2a2a2a',
  text1:  '#e8e8e8',
  text2:  '#888888',
  text3:  '#444444',
  red:    '#ef4444',
  redDim: '#7f1d1d',
  green:  '#22c55e',
  greenDim: '#166534',
  blue:   '#3b82f6',
  blueDim: '#1e3a5f',
  amber:  '#f59e0b',
  font:   "'Syne', sans-serif",
  body:   "'DM Sans', sans-serif",
};

// Severity → colour for the header badge
const SEV_COLOR = {
  Critical: { bg: '#7f1d1d', border: '#ef444488', text: '#f87171' },
  High:     { bg: '#78350f', border: '#f59e0b88', text: '#fbbf24' },
  Low:      { bg: '#166534', border: '#22c55e88', text: '#4ade80' },
  Unknown:  { bg: '#1e2a45', border: '#3b82f688', text: '#60a5fa' },
};

// Suggested quick-replies shown before the user types
const QUICK_REPLIES = [
  "I can't breathe properly",
  "There's a lot of blood",
  "I feel dizzy and faint",
  "Someone else is injured",
];

// ──────────────────────────────────────────────────────────────────────────
export default function VictimChat({ emergencyId, severity = 'Unknown', onClose }) {
  const [messages,    setMessages]    = useState([]);
  const [input,       setInput]       = useState('');
  const [isLoading,   setIsLoading]   = useState(false);
  const [showQuick,   setShowQuick]   = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);

  // Opening message from the AI operator when chat mounts
  useEffect(() => {
    const sevLabel = severity || 'Unknown';
    const opening =
      sevLabel === 'Critical'
        ? "Emergency services are en route right now. Do NOT move. Stay on the line and tell me what you're experiencing."
        : sevLabel === 'High'
        ? "Help is on the way. Stay calm and keep still. Can you tell me what happened?"
        : "I can see your SOS signal and help is coming. What's your current situation?";

    setMessages([{ id: 1, sender: 'ai', text: opening, ts: new Date() }]);
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── Send message ─────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    setInput('');
    setShowQuick(false);

    // Add user bubble immediately
    const userMsg = { id: Date.now(), sender: 'user', text: trimmed, ts: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch('http://localhost:8001/emergency-chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_message:   trimmed,
          severity_score: severity || 'Unknown',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error ${res.status}`);
      }

      const data = await res.json();
      const aiMsg = {
        id:     Date.now() + 1,
        sender: 'ai',
        text:   data.response,
        ts:     new Date(),
        tokens: data.tokens_used,
      };
      setMessages(prev => [...prev, aiMsg]);

    } catch (err) {
      const errMsg = {
        id:     Date.now() + 1,
        sender: 'ai',
        text:   'I\'m having trouble connecting right now, but help is already on the way. Stay calm and stay on the line.',
        ts:     new Date(),
        isError: true,
      };
      setMessages(prev => [...prev, errMsg]);
      console.error('Emergency chat error:', err);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isLoading, severity]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const sevStyle = SEV_COLOR[severity] || SEV_COLOR.Unknown;

  // ── Format timestamp ─────────────────────────────────────────────────
  const fmt = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', background: T.bg0,
      animation: 'lb-fadein .25s ease',
    }}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #0d1224, #111827)',
        borderBottom: `1px solid ${T.border}`,
        padding: '14px 18px',
        flexShrink: 0,
      }}>
        {/* Top row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* AI avatar */}
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: T.blueDim,
              border: `1.5px solid ${T.blue}66`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative',
            }}>
              <Bot size={18} color={T.blue} />
              {/* Online dot */}
              <span style={{
                position: 'absolute', bottom: 0, right: 0,
                width: 9, height: 9, borderRadius: '50%',
                background: T.green, border: `2px solid ${T.bg0}`,
              }} />
            </div>
            <div>
              <p style={{ margin: 0, fontFamily: T.font, fontWeight: 700, fontSize: 13, color: T.text1 }}>
                AI Emergency Operator
              </p>
              <p style={{ margin: 0, fontSize: 10, color: T.green, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', background: T.green,
                  display: 'inline-block', animation: 'lb-pulse 1.5s infinite',
                }} />
                Live · Help is on the way
              </p>
            </div>
          </div>

          {/* Severity badge */}
          <div style={{
            background: sevStyle.bg,
            border: `1px solid ${sevStyle.border}`,
            borderRadius: 8,
            padding: '5px 10px',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <AlertTriangle size={11} color={sevStyle.text} />
            <span style={{
              fontFamily: T.font, fontWeight: 700, fontSize: 10,
              letterSpacing: 1, color: sevStyle.text,
            }}>
              {(severity || 'UNKNOWN').toUpperCase()}
            </span>
          </div>
        </div>

        {/* Info strip */}
        <div style={{
          background: 'rgba(239,68,68,.06)',
          border: `1px solid rgba(239,68,68,.15)`,
          borderRadius: 8,
          padding: '7px 12px',
          display: 'flex', alignItems: 'center', gap: 7,
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>🚑</span>
          <p style={{ margin: 0, fontSize: 11, color: '#f87171', fontFamily: T.body, lineHeight: 1.5 }}>
            <strong>SOS #{emergencyId}</strong> — Paramedics have your location and medical vault.
            This chat is monitored by dispatch.
          </p>
        </div>
      </div>

      {/* ── Messages ────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 16px 8px',
        display: 'flex', flexDirection: 'column', gap: 12,
        scrollbarWidth: 'thin',
        scrollbarColor: `${T.border} transparent`,
      }}>
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} fmt={fmt} />
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: T.blueDim, border: `1px solid ${T.blue}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Bot size={13} color={T.blue} />
            </div>
            <div style={{
              background: T.bg2, border: `1px solid ${T.border}`,
              borderRadius: '14px 14px 14px 2px',
              padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: T.blue,
                  display: 'inline-block',
                  animation: `lb-pulse 1.2s ${i * 0.2}s ease-in-out infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        {/* Quick replies — shown before first user message */}
        {showQuick && messages.length > 0 && !isLoading && (
          <div style={{ marginTop: 4 }}>
            <p style={{
              fontSize: 10, color: T.text3, fontFamily: T.font,
              letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8,
            }}>
              Quick responses
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {QUICK_REPLIES.map(qr => (
                <button
                  key={qr}
                  onClick={() => sendMessage(qr)}
                  style={{
                    background: T.bg2,
                    border: `1px solid ${T.border}`,
                    borderRadius: 20,
                    padding: '7px 13px',
                    color: T.text2,
                    fontFamily: T.body,
                    fontSize: 12,
                    cursor: 'pointer',
                    transition: 'all .15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = T.blue;
                    e.currentTarget.style.color = '#60a5fa';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = T.border;
                    e.currentTarget.style.color = T.text2;
                  }}
                >
                  {qr}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ───────────────────────────────────────────────── */}
      <div style={{
        padding: '12px 16px 16px',
        borderTop: `1px solid ${T.border}`,
        background: T.bg1,
        flexShrink: 0,
      }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{
            flex: 1,
            background: T.bg2,
            border: `1px solid ${T.border}`,
            borderRadius: 14,
            padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 8,
            transition: 'border-color .15s',
          }}
            onFocusCapture={e => e.currentTarget.style.borderColor = T.blue}
            onBlurCapture={e => e.currentTarget.style.borderColor = T.border}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what's happening..."
              disabled={isLoading}
              rows={1}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: T.text1,
                fontFamily: T.body,
                fontSize: 13,
                resize: 'none',
                lineHeight: 1.5,
                maxHeight: 80,
                overflowY: 'auto',
                opacity: isLoading ? .5 : 1,
              }}
            />
          </div>

          {/* Send button */}
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            style={{
              width: 42, height: 42,
              borderRadius: 12,
              background: input.trim() && !isLoading ? T.red : T.bg2,
              border: `1px solid ${input.trim() && !isLoading ? T.red : T.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed',
              transition: 'all .15s',
              flexShrink: 0,
            }}
          >
            {isLoading
              ? <Loader size={16} color={T.text3} style={{ animation: 'lb-spin .8s linear infinite' }} />
              : <Send size={16} color={input.trim() ? '#fff' : T.text3} />
            }
          </button>
        </form>

        <p style={{ margin: '8px 0 0', fontSize: 10, color: T.text3, textAlign: 'center', fontFamily: T.body }}>
          Powered by Groq · llama-3.1-8b-instant · This is AI guidance, not a diagnosis
        </p>
      </div>
    </div>
  );
}

// ── Individual message bubble ──────────────────────────────────────────────
function MessageBubble({ msg, fmt }) {
  const isAI = msg.sender === 'ai';

  return (
    <div style={{
      display: 'flex',
      flexDirection: isAI ? 'row' : 'row-reverse',
      alignItems: 'flex-end',
      gap: 8,
      animation: 'lb-fadein .2s ease',
    }}>
      {/* Avatar */}
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background:  isAI ? T.blueDim : T.redDim,
        border:      `1px solid ${isAI ? T.blue + '44' : T.red + '44'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {isAI
          ? <Bot  size={13} color={T.blue} />
          : <User size={13} color={T.red} />
        }
      </div>

      <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 3, alignItems: isAI ? 'flex-start' : 'flex-end' }}>
        {/* Bubble */}
        <div style={{
          background: isAI
            ? msg.isError ? '#1a0d0d' : T.bg2
            : 'linear-gradient(135deg, #7f1d1d, #991b1b)',
          border: `1px solid ${isAI ? (msg.isError ? '#ef444422' : T.border) : '#ef444444'}`,
          borderRadius: isAI ? '14px 14px 14px 2px' : '14px 14px 2px 14px',
          padding: '11px 14px',
        }}>
          <p style={{
            margin: 0,
            fontSize: 13,
            color: isAI ? (msg.isError ? '#f87171' : T.text1) : '#fff',
            fontFamily: T.body,
            lineHeight: 1.6,
          }}>
            {msg.text}
          </p>
        </div>

        {/* Timestamp */}
        <span style={{
          fontSize: 9,
          color: T.text3,
          fontFamily: "'Space Mono', monospace",
          letterSpacing: .5,
          paddingLeft: 2,
          paddingRight: 2,
        }}>
          {fmt(msg.ts)}
          {isAI && msg.tokens && (
            <span style={{ opacity: .5 }}> · {msg.tokens} tokens</span>
          )}
        </span>
      </div>
    </div>
  );
}
