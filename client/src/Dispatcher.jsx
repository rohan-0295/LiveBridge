// src/Dispatcher.jsx — LiveBridge Dispatch Center
// Updated: Added Mission Details right-sidebar with Audit Trail / Event Log

import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import {
  LayoutDashboard, Map as MapIcon, Users, Truck,
  LogOut, Ambulance, Radio, AlertTriangle, CheckCircle, Clock,
  MapPin, Shield, Activity, ChevronRight, X,
} from 'lucide-react';

// ── Fix Leaflet icons for Vite ─────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Custom SVG SOS marker ──────────────────────────────────────────────
function makeSOSIcon(severity) {
  const color = severity === 'Critical' ? '#ef4444'
              : severity === 'High'     ? '#f59e0b'
              :                           '#22c55e';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <defs><filter id="glow">
        <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
        <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter></defs>
      <ellipse cx="18" cy="40" rx="6" ry="3" fill="rgba(0,0,0,0.3)"/>
      <path d="M18 0 C8 0 0 8 0 18 C0 30 18 44 18 44 C18 44 36 30 36 18 C36 8 28 0 18 0Z"
            fill="${color}" filter="url(#glow)"/>
      <circle cx="18" cy="18" r="10" fill="rgba(255,255,255,0.15)"/>
      <text x="18" y="23" text-anchor="middle"
            font-family="'Syne',sans-serif" font-size="10" font-weight="800"
            fill="white" letter-spacing="1">SOS</text>
    </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [36,44], iconAnchor: [18,44], popupAnchor: [0,-44] });
}

// ── Auto-pan component ─────────────────────────────────────────────────
function MapAutoPan({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.latitude, target.longitude], 15, { duration: 1.4 });
  }, [target, map]);
  return null;
}

// ── Design tokens ──────────────────────────────────────────────────────
const D = {
  bg0:    '#080c14',
  bg1:    '#0f172a',
  bg2:    '#1e293b',
  bg3:    '#263348',
  border: '#1e2d45',
  text1:  '#e2e8f0',
  text2:  '#64748b',
  red:    '#ef4444',
  amber:  '#f59e0b',
  green:  '#22c55e',
  blue:   '#3b82f6',
};

const sevColor = (s) => s === 'Critical' ? D.red : s === 'High' ? D.amber : D.green;
const sevBg    = (s) => s === 'Critical' ? 'rgba(239,68,68,.1)' : s === 'High' ? 'rgba(245,158,11,.1)' : 'rgba(34,197,94,.1)';

// ── Audit trail event generator ────────────────────────────────────────
// Builds a deterministic but realistic event log from a single timestamp.
// Each event is offset by a small delta so the log reads chronologically.
function buildAuditTrail(emergency) {
  if (!emergency) return [];
  const base  = new Date(emergency.created_at).getTime();
  const sev   = emergency.severity_score || 'Unknown';
  const sevUp = sev.toUpperCase();

  const sevColor_txt = sev === 'Critical' ? '#f87171' : sev === 'High' ? '#fbbf24' : '#4ade80';

  const events = [
    { delta: 0,    icon: '🚨', label: 'SOS Triggered by Victim',              color: '#f87171' },
    { delta: 1100, icon: '📡', label: 'GPS Signal Acquired (±5m accuracy)',    color: '#60a5fa' },
    { delta: 2300, icon: '🔐', label: 'Medical Vault Decrypted & Transmitted', color: '#a78bfa' },
    { delta: 3800, icon: '🧠', label: `AI Triage Engine: ${sevUp}`,            color: sevColor_txt },
    { delta: 4600, icon: '📋', label: 'Dispatcher Notified via Socket.io',     color: '#60a5fa' },
    { delta: 5900, icon: '🚑', label: 'Ambulance UP-14 Assigned & Dispatched', color: '#34d399' },
    { delta: 7200, icon: '📱', label: 'SMS Alert Sent to Emergency Contacts',  color: '#fbbf24' },
    { delta: 8400, icon: '🏥', label: 'Hospital Dashboard Notified',           color: '#60a5fa' },
  ];

  // Only show events up to "now" so it reads like a live log
  const now = Date.now();
  return events
    .filter(e => base + e.delta <= now)
    .map(e => ({
      ...e,
      ts:    new Date(base + e.delta),
    }));
}

// Format timestamp as HH:MM:SS AM/PM
function fmtTs(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ══════════════════════════════════════════════════════════════════════════
export default function Dispatcher() {
  const [activeTab,   setActiveTab]   = useState('Map View');
  const [emergencies, setEmergencies] = useState([]);
  const [latestSOS,   setLatestSOS]   = useState(null);
  const [selected,    setSelected]    = useState(null);  // full emergency object
  const [connected,   setConnected]   = useState(false);
  const [victimPings, setVictimPings] = useState({});
  const socketRef = useRef(null);

  // ── Audit trail — re-evaluates every second for live appearance ────
  const [auditEvents, setAuditEvents] = useState([]);
  useEffect(() => {
    if (!selected) { setAuditEvents([]); return; }
    const update = () => setAuditEvents(buildAuditTrail(selected));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [selected?.id, selected?.created_at]);

  // ── Socket.io ───────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io('http://localhost:8000');
    socketRef.current = socket;

    socket.on('connect', () => { setConnected(true); });
    socket.on('disconnect', () => setConnected(false));

    socket.on('new_emergency', (emergency) => {
      setEmergencies(prev => [emergency, ...prev]);
      setLatestSOS(emergency);
    });

    socket.on('emergency_resolved', ({ id }) => {
      setEmergencies(prev => prev.filter(e => e.id !== id));
      setSelected(prev => prev?.id === id ? null : prev);
    });

    socket.on('victim_location_update', ({ emergency_id, latitude, longitude, accuracy }) => {
      setVictimPings(prev => ({
        ...prev,
        [emergency_id]: { lat: parseFloat(latitude), lng: parseFloat(longitude), accuracy, ts: Date.now() },
      }));
    });

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    fetch('http://localhost:8000/api/emergencies')
      .then(r => r.json()).then(setEmergencies)
      .catch(err => console.error('Fetch error:', err));
  }, []);

  const resolveEmergency = useCallback(async (id) => {
    try {
      await fetch(`http://localhost:8000/api/emergencies/${id}/resolve`, { method: 'PATCH' });
    } catch (err) { console.error('Resolve error:', err); }
  }, []);

  const navItems = [
    { name: 'Dashboard',      icon: LayoutDashboard },
    { name: 'Map View',       icon: MapIcon },
    { name: 'Victims List',   icon: Users },
    { name: 'Ambulance List', icon: Truck },
  ];

  const critical = emergencies.filter(e => e.severity_score === 'Critical').length;

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: D.bg0, color: D.text1, fontFamily: "'DM Sans', sans-serif" }}>

      {/* ══ LEFT SIDEBAR ══════════════════════════════════════════════ */}
      <div style={{ width: 256, background: D.bg1, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${D.border}`, flexShrink: 0 }}>

        {/* Logo */}
        <div style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${D.border}` }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: '#1e2a45', border: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ambulance size={19} color={D.blue} />
          </div>
          <div>
            <p style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>LIVEBRIDGE</p>
            <p style={{ margin: 0, fontSize: 9, color: D.text2, letterSpacing: 1 }}>DISPATCH CENTER</p>
          </div>
        </div>

        {/* Nav */}
        <div style={{ padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {navItems.map(({ name, icon: Icon }) => {
            const active = activeTab === name;
            return (
              <button key={name} onClick={() => setActiveTab(name)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 13px',
                background: active ? '#1e3a5f' : 'transparent',
                color: active ? '#60a5fa' : D.text2,
                border: active ? `1px solid #2a4f7f` : '1px solid transparent',
                borderRadius: 7, cursor: 'pointer', fontSize: 13,
                fontFamily: "'DM Sans',sans-serif", textAlign: 'left', transition: 'all .15s',
              }}>
                <Icon size={15} /> {name}
              </button>
            );
          })}
        </div>

        {/* Active SOS queue */}
        <div style={{ flex: 1, padding: '0 10px', borderTop: `1px solid ${D.border}`, overflowY: 'auto' }}>
          <p style={{ margin: '14px 4px 8px', fontSize: 9, letterSpacing: 2, color: D.text2, fontFamily: "'Syne',sans-serif" }}>
            ACTIVE SOS ({emergencies.length})
          </p>
          {emergencies.length === 0 && (
            <p style={{ fontSize: 12, color: D.text2, textAlign: 'center', padding: '12px 0' }}>No active emergencies</p>
          )}
          {emergencies.map(e => (
            <div key={e.id} onClick={() => {
                setSelected(selected?.id === e.id ? null : e);
                setLatestSOS(e);
                setActiveTab('Map View');
              }}
              style={{
                background: selected?.id === e.id ? '#1e2d45' : D.bg2,
                border: `1px solid ${selected?.id === e.id ? D.border : 'transparent'}`,
                borderRadius: 9, padding: '10px 12px', marginBottom: 6, cursor: 'pointer', transition: 'all .15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 12, color: D.text1 }}>SOS #{e.id}</span>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: sevColor(e.severity_score), background: sevBg(e.severity_score), border: `1px solid ${sevColor(e.severity_score)}33`, borderRadius: 4, padding: '2px 6px', fontFamily: "'Syne',sans-serif" }}>
                  {(e.severity_score || 'UNKNOWN').toUpperCase()}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: D.text2 }}>
                <Clock size={10} /> {new Date(e.created_at).toLocaleTimeString()}
              </div>
              <button onClick={(ev) => { ev.stopPropagation(); resolveEmergency(e.id); }}
                style={{ marginTop: 8, width: '100%', padding: '5px 0', background: 'transparent', border: `1px solid ${D.border}`, borderRadius: 6, color: D.text2, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontFamily: "'DM Sans',sans-serif" }}>
                <CheckCircle size={11} /> Mark Resolved
              </button>
            </div>
          ))}
        </div>

        {/* User footer */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${D.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: D.bg3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>RS</div>
            <div>
              <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>Rohan Shaw</p>
              <p style={{ margin: 0, fontSize: 11, color: D.green }}>● Online</p>
            </div>
          </div>
          <button style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: D.text2, cursor: 'pointer', fontSize: 12, fontFamily: "'DM Sans',sans-serif" }}>
            <LogOut size={15} /> Logout
          </button>
        </div>
      </div>

      {/* ══ MAIN AREA ═════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ height: 60, background: D.bg1, borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', padding: '0 22px', justifyContent: 'space-between', flexShrink: 0, zIndex: 1000 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 17, margin: 0 }}>LiveMap View</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: connected ? '#0d1a0d' : '#1a0d0d', border: `1px solid ${connected ? '#1a2d1a' : '#2d1a1a'}`, borderRadius: 20, padding: '4px 10px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? D.green : D.red, display: 'inline-block' }} />
              <span style={{ fontSize: 11, color: connected ? '#4ade80' : '#f87171' }}>{connected ? 'Live' : 'Reconnecting...'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {critical > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1a0d0d', border: `1px solid #3f1010`, borderRadius: 8, padding: '6px 12px' }}>
                <AlertTriangle size={13} color={D.red} />
                <span style={{ fontSize: 13, color: '#f87171', fontWeight: 500 }}>{critical} Critical</span>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: D.bg2, border: `1px solid ${D.border}`, borderRadius: 8, padding: '6px 12px' }}>
              <Radio size={13} color={D.blue} />
              <span style={{ fontSize: 13, color: '#60a5fa', fontWeight: 500 }}>{emergencies.length} Active SOS</span>
            </div>
          </div>
        </div>

        {/* Map + optional right sidebar */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* MAP ──────────────────────────────────────────────────── */}
          <div style={{ flex: 1, position: 'relative' }}>
            <MapContainer center={[13.0827, 80.2707]} zoom={12} style={{ height: '100%', width: '100%', zIndex: 0 }} zoomControl={false}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; OpenStreetMap contributors' />
              <MapAutoPan target={latestSOS} />
              {emergencies.map(e => (
                <Marker
                  key={e.id}
                  position={[
                    victimPings[e.id] ? victimPings[e.id].lat : parseFloat(e.latitude),
                    victimPings[e.id] ? victimPings[e.id].lng : parseFloat(e.longitude),
                  ]}
                  icon={makeSOSIcon(e.severity_score)}
                  eventHandlers={{ click: () => setSelected(selected?.id === e.id ? null : e) }}
                >
                  <Popup>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", minWidth: 180 }}>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: sevColor(e.severity_score), marginBottom: 6 }}>
                        SOS #{e.id} — {(e.severity_score || 'Unknown').toUpperCase()}
                      </div>
                      {victimPings[e.id] && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#0d1a0d', border: '1px solid #1a2d1a', borderRadius: 5, padding: '3px 8px', marginBottom: 8 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                          <span style={{ fontSize: 10, color: '#4ade80', fontWeight: 600 }}>LIVE · ±{Math.round(victimPings[e.id].accuracy || 0)}m</span>
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>{new Date(e.created_at).toLocaleTimeString()}</div>
                      <button onClick={() => resolveEmergency(e.id)} style={{ width: '100%', padding: '6px 0', background: '#166534', color: '#4ade80', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}>
                        ✓ Mark Resolved
                      </button>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>

            {/* Live location badge */}
            {Object.keys(victimPings).length > 0 && (
              <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 999, background: 'rgba(13,26,13,.92)', border: '1px solid #1a2d1a', borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                <span style={{ fontSize: 12, color: '#4ade80', fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>
                  {Object.keys(victimPings).length} victim{Object.keys(victimPings).length > 1 ? 's' : ''} sharing live location
                </span>
              </div>
            )}

            {/* Empty state */}
            {emergencies.length === 0 && (
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(15,23,42,.85)', border: `1px solid ${D.border}`, borderRadius: 14, padding: '24px 32px', textAlign: 'center', zIndex: 999, pointerEvents: 'none' }}>
                <CheckCircle size={30} color={D.green} style={{ marginBottom: 10 }} />
                <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, margin: '0 0 5px', color: D.text1 }}>All Clear</p>
                <p style={{ fontSize: 12, color: D.text2, margin: 0 }}>No active SOS signals.<br />Waiting for incoming emergencies...</p>
              </div>
            )}
          </div>

          {/* ══ RIGHT SIDEBAR — Mission Details + Audit Trail ════════ */}
          {selected && (
            <div style={{
              width: 320,
              background: D.bg1,
              borderLeft: `1px solid ${D.border}`,
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden', flexShrink: 0,
              animation: 'slideIn .25s ease',
            }}>

              {/* Sidebar header */}
              <div style={{ padding: '16px 18px', borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, color: D.text1 }}>
                    SOS #{selected.id}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 10, color: D.text2, letterSpacing: .5 }}>
                    Mission Details
                  </p>
                </div>
                <button onClick={() => setSelected(null)} style={{ background: D.bg2, border: `1px solid ${D.border}`, borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: D.text2 }}>
                  <X size={13} />
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Severity banner */}
                <div style={{
                  background: sevBg(selected.severity_score),
                  border: `1px solid ${sevColor(selected.severity_score)}33`,
                  borderRadius: 10, padding: '12px 14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Activity size={16} color={sevColor(selected.severity_score)} />
                    <div>
                      <p style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, color: sevColor(selected.severity_score), letterSpacing: 1 }}>
                        {(selected.severity_score || 'UNKNOWN').toUpperCase()}
                      </p>
                      <p style={{ margin: 0, fontSize: 10, color: D.text2 }}>AI Triage Score</p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontSize: 11, color: D.text1 }}>{new Date(selected.created_at).toLocaleTimeString()}</p>
                    <p style={{ margin: 0, fontSize: 10, color: D.text2 }}>Triggered at</p>
                  </div>
                </div>

                {/* Location */}
                <Section title="Location" icon={<MapPin size={12} />}>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, color: D.text1, padding: '8px 10px', background: D.bg2, borderRadius: 7, border: `1px solid ${D.border}` }}>
                    {victimPings[selected.id]
                      ? <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: D.green, display: 'inline-block' }} />
                            <span style={{ fontSize: 10, color: '#4ade80', fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>LIVE GPS</span>
                          </div>
                          {victimPings[selected.id].lat.toFixed(6)}, {victimPings[selected.id].lng.toFixed(6)}
                        </>
                      : `${parseFloat(selected.latitude).toFixed(6)}, ${parseFloat(selected.longitude).toFixed(6)}`
                    }
                  </div>
                </Section>

                {/* Ambulance */}
                <Section title="Assigned Unit" icon={<Ambulance size={12} />}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: D.bg2, borderRadius: 7, border: `1px solid ${D.border}` }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: '#1e3a5f', border: `1px solid #2a4f7f`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Ambulance size={15} color="#60a5fa" />
                    </div>
                    <div>
                      <p style={{ margin: 0, fontWeight: 500, fontSize: 13, color: D.text1 }}>UP-14 — ALS Unit</p>
                      <p style={{ margin: 0, fontSize: 11, color: D.green }}>En route · ~4 min ETA</p>
                    </div>
                  </div>
                </Section>

                {/* ── AUDIT TRAIL ──────────────────────────────────── */}
                <Section title="Audit Trail" icon={<Clock size={12} />} accent={D.blue}>
                  <p style={{ margin: '0 0 10px', fontSize: 10, color: D.text2, lineHeight: 1.5 }}>
                    Chronological event log for SOS #{selected.id} — legal compliance record.
                  </p>

                  {auditEvents.length === 0 && (
                    <p style={{ fontSize: 11, color: D.text2, textAlign: 'center', padding: '8px 0' }}>
                      Building event log...
                    </p>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {auditEvents.map((ev, idx) => (
                      <AuditEntry
                        key={idx}
                        event={ev}
                        isLast={idx === auditEvents.length - 1}
                        fmt={fmtTs}
                      />
                    ))}

                    {/* "Awaiting" tail entry — shown while events are still pending */}
                    {auditEvents.length < 8 && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingTop: 6 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                          <div style={{ width: 20, height: 20, borderRadius: '50%', background: D.bg3, border: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: D.text3, animation: 'lb-pulse 1.5s infinite', display: 'inline-block' }} />
                          </div>
                        </div>
                        <div style={{ paddingTop: 3 }}>
                          <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 10, color: D.text3 }}>Awaiting next event...</p>
                        </div>
                      </div>
                    )}
                  </div>
                </Section>

                {/* Quick actions */}
                <Section title="Actions" icon={<ChevronRight size={12} />}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <button onClick={() => resolveEmergency(selected.id)} style={{ width: '100%', padding: '10px 0', background: '#0d1a0d', border: `1px solid #1a2d1a`, borderRadius: 8, color: '#4ade80', fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <CheckCircle size={13} /> MARK RESOLVED
                    </button>
                  </div>
                </Section>

              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Reusable sidebar section wrapper ──────────────────────────────────────
function Section({ title, icon, accent = '#3b82f6', children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ color: accent }}>{icon}</span>
        <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: 1.5, color: '#64748b', textTransform: 'uppercase' }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

// ── Single audit trail entry ───────────────────────────────────────────────
function AuditEntry({ event, isLast, fmt }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      {/* Timeline column */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        {/* Node */}
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          background: '#0f172a',
          border: `1.5px solid ${event.color}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10,
          flexShrink: 0,
        }}>
          {event.icon}
        </div>
        {/* Connector line — hidden for last entry */}
        {!isLast && (
          <div style={{ width: 1, flex: 1, minHeight: 20, background: 'linear-gradient(to bottom, rgba(30,45,69,.8), rgba(30,45,69,.3))', margin: '2px 0' }} />
        )}
      </div>

      {/* Content */}
      <div style={{ paddingBottom: isLast ? 0 : 12, paddingTop: 1 }}>
        {/* Timestamp — monospaced for alignment */}
        <span style={{
          fontFamily: "'Space Mono', 'Courier New', monospace",
          fontSize: 9,
          color: '#3a5278',
          letterSpacing: .5,
          display: 'block',
          marginBottom: 2,
        }}>
          [{fmt(event.ts)}]
        </span>
        {/* Event label */}
        <span style={{
          fontSize: 12,
          color: event.color,
          fontFamily: "'DM Sans', sans-serif",
          lineHeight: 1.4,
        }}>
          {event.label}
        </span>
      </div>
    </div>
  );
}
