import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import {
  LayoutDashboard, Map as MapIcon, Users, Truck,
  LogOut, Ambulance, Radio, AlertTriangle, CheckCircle, Clock
} from 'lucide-react';

// ── Fix broken default Leaflet icons in Vite ─────────────────────────────
// Vite's bundler moves assets and breaks Leaflet's default icon URL resolution.
// We override with CDN URLs so markers always render.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Custom SVG marker factory ─────────────────────────────────────────────
function makeSOSIcon(severity) {
  const color = severity === 'Critical' ? '#ef4444'
              : severity === 'High'     ? '#f59e0b'
              :                           '#22c55e';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <ellipse cx="18" cy="40" rx="6" ry="3" fill="rgba(0,0,0,0.3)"/>
      <path d="M18 0 C8 0 0 8 0 18 C0 30 18 44 18 44 C18 44 36 30 36 18 C36 8 28 0 18 0Z"
            fill="${color}" filter="url(#glow)"/>
      <circle cx="18" cy="18" r="10" fill="rgba(255,255,255,0.15)"/>
      <text x="18" y="23" text-anchor="middle"
            font-family="'Syne',sans-serif" font-size="10" font-weight="800"
            fill="white" letter-spacing="1">SOS</text>
    </svg>`;

  return L.divIcon({
    html: svg,
    className: '',
    iconSize:   [36, 44],
    iconAnchor: [18, 44],
    popupAnchor:[0, -44],
  });
}

// ── Component: auto-pan map to new marker ─────────────────────────────────
function MapAutoPan({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo([target.latitude, target.longitude], 15, { duration: 1.4 });
    }
  }, [target, map]);
  return null;
}

// ── Design tokens ─────────────────────────────────────────────────────────
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

const sevColor = (s) =>
  s === 'Critical' ? D.red : s === 'High' ? D.amber : D.green;

// ═════════════════════════════════════════════════════════════════════════════
export default function Dispatcher() {
  const [activeTab,    setActiveTab]    = useState('Map View');
  const [emergencies,  setEmergencies]  = useState([]);
  const [latestSOS,    setLatestSOS]    = useState(null);   // triggers map pan
  const [selected,     setSelected]     = useState(null);   // selected emergency id
  const [connected,    setConnected]    = useState(false);
  const socketRef = useRef(null);

  // ── Socket.io — real-time SOS feed ──────────────────────────────────────
  useEffect(() => {
    const socket = io('http://localhost:8000');
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      console.log('🔌 Socket connected');
    });

    socket.on('disconnect', () => setConnected(false));

    // New SOS arrives → add to list and pan map
    socket.on('new_emergency', (emergency) => {
      console.log('🚨 New SOS received:', emergency);
      setEmergencies(prev => [emergency, ...prev]);
      setLatestSOS(emergency);
    });

    // Emergency resolved → remove from active list
    socket.on('emergency_resolved', ({ id }) => {
      setEmergencies(prev => prev.filter(e => e.id !== id));
    });

    return () => socket.disconnect();
  }, []);

  // ── Initial fetch (emergencies already in DB before socket connected) ───
  useEffect(() => {
    fetch('http://localhost:8000/api/emergencies')
      .then(r => r.json())
      .then(data => setEmergencies(data))
      .catch(err => console.error('Failed to fetch emergencies:', err));
  }, []);

  // ── Resolve an emergency ─────────────────────────────────────────────────
  const resolveEmergency = useCallback(async (id) => {
    try {
      await fetch(`http://localhost:8000/api/emergencies/${id}/resolve`, { method: 'PATCH' });
      // Socket event will handle removing it from state
    } catch (err) {
      console.error('Failed to resolve:', err);
    }
  }, []);

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard },
    { name: 'Map View',  icon: MapIcon },
    { name: 'Victims List', icon: Users },
    { name: 'Ambulance List', icon: Truck },
  ];

  const critical = emergencies.filter(e => e.severity_score === 'Critical').length;

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: D.bg0, color: D.text1, fontFamily: "'DM Sans', sans-serif" }}>

      {/* ── SIDEBAR ───────────────────────────────────────────────────────── */}
      <div style={{ width: 260, background: D.bg1, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${D.border}`, flexShrink: 0 }}>

        {/* Logo */}
        <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${D.border}` }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: '#1e2a45', border: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ambulance size={20} color={D.blue} />
          </div>
          <div>
            <p style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: 1, color: D.text1 }}>LIVEBRIDGE</p>
            <p style={{ margin: 0, fontSize: 10, color: D.text2, letterSpacing: 1 }}>DISPATCH CENTER</p>
          </div>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {navItems.map(({ name, icon: Icon }) => {
            const active = activeTab === name;
            return (
              <button key={name} onClick={() => setActiveTab(name)} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px',
                background: active ? '#1e3a5f' : 'transparent',
                color: active ? '#60a5fa' : D.text2,
                border: active ? `1px solid #2a4f7f` : '1px solid transparent',
                borderRadius: 8, cursor: 'pointer', fontSize: 14,
                fontFamily: "'DM Sans',sans-serif", textAlign: 'left', transition: 'all .15s',
              }}>
                <Icon size={17} /> {name}
              </button>
            );
          })}
        </div>

        {/* Active SOS list */}
        <div style={{ padding: '16px 12px', borderTop: `1px solid ${D.border}`, maxHeight: 280, overflowY: 'auto' }}>
          <p style={{ margin: '0 0 10px 4px', fontSize: 10, letterSpacing: 2, color: D.text2, fontFamily: "'Syne',sans-serif" }}>
            ACTIVE SOS ({emergencies.length})
          </p>
          {emergencies.length === 0 && (
            <p style={{ fontSize: 12, color: D.text2, textAlign: 'center', padding: '12px 0' }}>No active emergencies</p>
          )}
          {emergencies.map(e => (
            <div
              key={e.id}
              onClick={() => { setSelected(e.id); setLatestSOS(e); setActiveTab('Map View'); }}
              style={{
                background: selected === e.id ? '#1e2d45' : D.bg2,
                border: `1px solid ${selected === e.id ? D.border : 'transparent'}`,
                borderRadius: 10, padding: '10px 12px', marginBottom: 6, cursor: 'pointer',
                transition: 'all .15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 12, color: D.text1 }}>SOS #{e.id}</span>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: 1,
                  color: sevColor(e.severity_score),
                  background: `${sevColor(e.severity_score)}18`,
                  border: `1px solid ${sevColor(e.severity_score)}33`,
                  borderRadius: 4, padding: '2px 6px',
                  fontFamily: "'Syne',sans-serif",
                }}>
                  {(e.severity_score || 'UNKNOWN').toUpperCase()}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: D.text2 }}>
                <Clock size={10} />
                {new Date(e.created_at).toLocaleTimeString()}
              </div>
              <button
                onClick={(ev) => { ev.stopPropagation(); resolveEmergency(e.id); }}
                style={{
                  marginTop: 8, width: '100%', padding: '5px 0',
                  background: 'transparent', border: `1px solid ${D.border}`,
                  borderRadius: 6, color: D.text2, fontSize: 11,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  fontFamily: "'DM Sans',sans-serif",
                }}
              >
                <CheckCircle size={11} /> Mark Resolved
              </button>
            </div>
          ))}
        </div>

        {/* User footer */}
        <div style={{ padding: '16px 24px', borderTop: `1px solid ${D.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: D.bg3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: D.text1 }}>RS</div>
            <div>
              <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>Rohan Shaw</p>
              <p style={{ margin: 0, fontSize: 11, color: D.green }}>● Online</p>
            </div>
          </div>
          <button style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: D.text2, cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans',sans-serif" }}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>

      {/* ── MAIN AREA ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{
          height: 64, background: D.bg1,
          borderBottom: `1px solid ${D.border}`,
          display: 'flex', alignItems: 'center',
          padding: '0 24px', justifyContent: 'space-between', flexShrink: 0, zIndex: 1000,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 18, margin: 0 }}>LiveMap View</h1>
            {/* Realtime indicator */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: connected ? '#0d1a0d' : '#1a0d0d',
              border: `1px solid ${connected ? '#1a2d1a' : '#2d1a1a'}`,
              borderRadius: 20, padding: '4px 10px',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? D.green : D.red, display: 'inline-block', animation: connected ? 'lb-pulse 2s infinite' : 'none' }} />
              <span style={{ fontSize: 11, color: connected ? '#4ade80' : '#f87171' }}>
                {connected ? 'Live' : 'Reconnecting...'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {critical > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1a0d0d', border: `1px solid #3f1010`, borderRadius: 8, padding: '6px 12px' }}>
                <AlertTriangle size={14} color={D.red} />
                <span style={{ fontSize: 13, color: '#f87171', fontWeight: 500 }}>{critical} Critical</span>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: D.bg2, border: `1px solid ${D.border}`, borderRadius: 8, padding: '6px 12px' }}>
              <Radio size={14} color={D.blue} />
              <span style={{ fontSize: 13, color: '#60a5fa', fontWeight: 500 }}>{emergencies.length} Active SOS</span>
            </div>
          </div>
        </div>

        {/* Leaflet map */}
        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer
            center={[13.0827, 80.2707]}
            zoom={12}
            style={{ height: '100%', width: '100%', zIndex: 0 }}
            zoomControl={false}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; OpenStreetMap contributors'
            />

            {/* Auto-pan when new SOS arrives */}
            <MapAutoPan target={latestSOS} />

            {emergencies.map((e) => (
              <Marker
                key={e.id}
                position={[parseFloat(e.latitude), parseFloat(e.longitude)]}
                icon={makeSOSIcon(e.severity_score)}
              >
                <Popup>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", minWidth: 180 }}>
                    <div style={{
                      fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14,
                      color: sevColor(e.severity_score), marginBottom: 6,
                    }}>
                      SOS #{e.id} — {(e.severity_score || 'Unknown').toUpperCase()}
                    </div>
                    <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
                      Status: <strong>{e.status}</strong>
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
                      {new Date(e.created_at).toLocaleTimeString()}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 10 }}>
                      {parseFloat(e.latitude).toFixed(5)}, {parseFloat(e.longitude).toFixed(5)}
                    </div>
                    <button
                      onClick={() => resolveEmergency(e.id)}
                      style={{
                        width: '100%', padding: '6px 0',
                        background: '#166534', color: '#4ade80',
                        border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
                      }}
                    >
                      ✓ Mark Resolved
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          {/* Empty state overlay */}
          {emergencies.length === 0 && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(15,23,42,0.85)',
              border: `1px solid ${D.border}`,
              borderRadius: 16, padding: '28px 36px',
              textAlign: 'center', zIndex: 999, pointerEvents: 'none',
            }}>
              <CheckCircle size={32} color={D.green} style={{ marginBottom: 12 }} />
              <p style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 16, margin: '0 0 6px', color: D.text1 }}>All Clear</p>
              <p style={{ fontSize: 13, color: D.text2, margin: 0 }}>No active SOS signals.<br />Waiting for incoming emergencies...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
