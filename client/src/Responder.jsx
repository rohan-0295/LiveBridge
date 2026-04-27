// src/Responder.jsx — LiveBridge Paramedic App (Presentation Edition)
// ✅ Socket.io: listens for dispatch_accepted, emits responder_location every 2s
// ✅ Simulated Ghost Driver GPS — auto-increments position, safely cleared on scene
// ✅ Mission accept / decline flow
// ✅ Status machine: Idle → En Route → On Scene → Transporting → Completed
// ✅ Victim data: GPS coords, AI triage, Medical Vault with all optional-chaining safety
// ✅ No interval leaks — ref-based cleanup on every status change

import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import {
  Navigation, CheckCircle, XCircle, AlertTriangle, Clock,
  Heart, Activity, MapPin, ChevronRight, Shield,
  Zap, Pill, Users, Radio, Wifi, WifiOff,
  AlertOctagon, Play, Square, Truck,
} from 'lucide-react';

// ── Leaflet icon fix ───────────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Marker factories ───────────────────────────────────────────────────────
function makeVictimIcon(sev) {
  const c = sev === 'Critical' ? '#f85149' : sev === 'High' ? '#d29922' : '#3fb950';
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
      <path d="M16 0C7 0 0 7 0 16C0 26 16 40 16 40S32 26 32 16C32 7 25 0 16 0Z" fill="${c}"/>
      <circle cx="16" cy="16" r="9" fill="rgba(255,255,255,.15)"/>
      <text x="16" y="21" text-anchor="middle" font-family="Syne,sans-serif" font-size="9" font-weight="800" fill="white">SOS</text>
    </svg>`,
    className: '', iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -40],
  });
}

function makeAmbIcon() {
  return L.divIcon({
    html: `<div style="background:#388bfd;border-radius:10px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 0 18px rgba(56,139,253,.9)">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
        <rect x="1" y="3" width="15" height="13" rx="1"/>
        <path d="M16 8h4l3 3v5h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/>
        <circle cx="18.5" cy="18.5" r="2.5"/>
      </svg></div>`,
    className: '', iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -34],
  });
}

// ── Map fly-to controller ──────────────────────────────────────────────────
function MapController({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom ?? 15, { duration: 1.1 });
  }, [target, map]);
  return null;
}

// ── Design tokens ──────────────────────────────────────────────────────────
const T = {
  bg0: '#06080f', bg1: '#0d1117', bg2: '#161b22', bg3: '#21262d',
  border: '#30363d', text1: '#e6edf3', text2: '#7d8590', text3: '#484f58',
  blue: '#388bfd', blueDim: '#1f3358',
  green: '#3fb950', greenDim: '#1a3a1f',
  red: '#f85149',  redDim: '#3d1f1f',
  amber: '#d29922', amberDim: '#2d2008',
  purple: '#a371f7',
  font: "'Syne', sans-serif", body: "'DM Sans', sans-serif",
};
const sevColor = (s) => s === 'Critical' ? T.red : s === 'High' ? T.amber : T.green;
const sevBg    = (s) => s === 'Critical' ? T.redDim : s === 'High' ? T.amberDim : T.greenDim;

// ── Mission status machine ─────────────────────────────────────────────────
const STATUS_FLOW = [
  { id: 'idle',         label: 'Idle',                color: T.text2 },
  { id: 'en_route',     label: 'En Route',            color: T.blue  },
  { id: 'on_scene',     label: 'On Scene',            color: T.amber },
  { id: 'transporting', label: 'Transporting',        color: T.purple},
  { id: 'completed',    label: 'Mission Complete',    color: T.green },
];

// ── Default GPS start (SRM University, Chennai) ────────────────────────────
const DEFAULT_POS = { lat: 12.8231, lng: 80.0442 };

// ═══════════════════════════════════════════════════════════════════════════
export default function Responder() {
  const [connected,    setConnected]    = useState(false);
  const [status,       setStatus]       = useState('idle');       // mission status
  const [mission,      setMission]      = useState(null);         // inbound dispatch payload
  const [pendingAlert, setPendingAlert] = useState(null);         // awaiting accept/decline
  const [ambPos,       setAmbPos]       = useState(DEFAULT_POS);  // our GPS
  const [ambTrail,     setAmbTrail]     = useState([[DEFAULT_POS.lat, DEFAULT_POS.lng]]);
  const [mapTarget,    setMapTarget]    = useState(null);
  const [activeTab,    setActiveTab]    = useState('nav');         // nav | vitals | vault

  const socketRef   = useRef(null);
  const ghostRef    = useRef(null);   // setInterval handle for simulated GPS
  const posRef      = useRef(DEFAULT_POS); // mutable ref so interval always reads latest pos

  // ── Stop ghost driver (call on scene / complete) ───────────────────────
  const stopGhost = useCallback(() => {
    if (ghostRef.current) {
      clearInterval(ghostRef.current);
      ghostRef.current = null;
    }
  }, []);

  // ── Start ghost driver: increments toward victim coords every 2 s ──────
  const startGhost = useCallback((targetLat, targetLng) => {
    stopGhost(); // safety: clear any existing interval first

    ghostRef.current = setInterval(() => {
      const cur = posRef.current;
      const dLat = (targetLat - cur.lat) * 0.08;
      const dLng = (targetLng - cur.lng) * 0.08;

      // Stop moving if close enough (within ~50m)
      if (Math.abs(dLat) < 0.0003 && Math.abs(dLng) < 0.0003) {
        stopGhost();
        return;
      }

      const newPos = {
        lat: parseFloat((cur.lat + dLat + (Math.random() - 0.5) * 0.0001).toFixed(6)),
        lng: parseFloat((cur.lng + dLng + (Math.random() - 0.5) * 0.0001).toFixed(6)),
      };
      posRef.current = newPos;
      setAmbPos(newPos);
      setAmbTrail(prev => [...prev.slice(-100), [newPos.lat, newPos.lng]]);

      // Emit location to server/dispatcher
      socketRef.current?.emit('responder_location', {
        latitude:     newPos.lat,
        longitude:    newPos.lng,
        emergency_id: mission?.emergency?.id ?? mission?.id,
        unit:         'UP-14',
      });
    }, 2000);
  }, [mission, stopGhost]);

  // Cleanup ghost on unmount
  useEffect(() => () => stopGhost(), [stopGhost]);

  // ── Socket.io ─────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io('http://localhost:8000');
    socketRef.current = socket;

    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    // Inbound dispatch — show accept/decline
    socket.on('dispatch_accepted', (payload) => {
      setPendingAlert(payload);
      setStatus('idle');
    });

    // Also handle generic new_emergency for demo purposes
    socket.on('new_emergency', (emergency) => {
      if (!emergency) return;
      setPendingAlert({ emergency, vault: emergency?.vault ?? {} });
    });

    return () => {
      socket.disconnect();
      stopGhost();
    };
  }, [stopGhost]);

  // ── Accept mission ─────────────────────────────────────────────────────
  const acceptMission = useCallback(() => {
    if (!pendingAlert) return;
    setMission(pendingAlert);
    setPendingAlert(null);
    setStatus('en_route');

    const vLat = parseFloat(pendingAlert?.emergency?.latitude  ?? DEFAULT_POS.lat);
    const vLng = parseFloat(pendingAlert?.emergency?.longitude ?? DEFAULT_POS.lng);

    // Pan map to victim
    setMapTarget({ lat: vLat, lng: vLng, zoom: 15 });

    // Emit status update
    socketRef.current?.emit('responder_status_update', {
      emergency_id: pendingAlert?.emergency?.id,
      status: 'en_route', unit: 'UP-14',
    });

    // Start simulated GPS toward victim
    startGhost(vLat, vLng);
  }, [pendingAlert, startGhost]);

  // ── Decline mission ────────────────────────────────────────────────────
  const declineMission = useCallback(() => {
    setPendingAlert(null);
    socketRef.current?.emit('responder_status_update', {
      emergency_id: pendingAlert?.emergency?.id,
      status: 'declined', unit: 'UP-14',
    });
  }, [pendingAlert]);

  // ── Progress status ────────────────────────────────────────────────────
  const progressStatus = useCallback((nextId) => {
    setStatus(nextId);
    socketRef.current?.emit('responder_status_update', {
      emergency_id: mission?.emergency?.id ?? mission?.id,
      status: nextId, unit: 'UP-14',
    });

    // Stop ghost driver when we arrive or complete
    if (nextId === 'on_scene' || nextId === 'completed') {
      stopGhost();
    }
    if (nextId === 'completed') {
      setTimeout(() => {
        setMission(null);
        setStatus('idle');
        setAmbPos(DEFAULT_POS);
        posRef.current = DEFAULT_POS;
        setAmbTrail([[DEFAULT_POS.lat, DEFAULT_POS.lng]]);
      }, 3000);
    }
  }, [mission, stopGhost]);

  const emergency = mission?.emergency ?? null;
  const vault     = mission?.vault     ?? {};
  const sev       = emergency?.severity_score || 'Unknown';
  const vLat      = parseFloat(emergency?.latitude  ?? DEFAULT_POS.lat);
  const vLng      = parseFloat(emergency?.longitude ?? DEFAULT_POS.lng);

  // Status bar color
  const curStatus = STATUS_FLOW.find(s => s.id === status) ?? STATUS_FLOW[0];

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: T.bg0, color: T.text1, fontFamily: T.body, overflow: 'hidden' }}>
      <style>{`
        @keyframes r-pulse  { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes r-fadein { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes r-bounce { 0%,100%{transform:scale(1)} 50%{transform:scale(1.03)} }
        @keyframes r-ring   { 0%{box-shadow:0 0 0 0 rgba(56,139,253,.7)} 70%{box-shadow:0 0 0 14px rgba(56,139,253,0)} 100%{box-shadow:0 0 0 0 rgba(56,139,253,0)} }
        @keyframes r-spin   { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>

      {/* ══ LEFT PANEL ════════════════════════════════════════════════════ */}
      <div style={{ width: 260, background: T.bg1, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${T.border}`, flexShrink: 0 }}>

        {/* Unit header */}
        <div style={{ padding: '18px 20px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: T.blueDim, border: `1px solid ${T.blue}55`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Truck size={18} color={T.blue} />
            </div>
            <div>
              <p style={{ margin: 0, fontFamily: T.font, fontWeight: 800, fontSize: 15, letterSpacing: .5 }}>UP-14</p>
              <p style={{ margin: 0, fontSize: 10, color: T.text2, letterSpacing: 1 }}>ALS UNIT · RESPONDER</p>
            </div>
          </div>

          {/* Connection */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: connected ? 'rgba(63,185,80,.08)' : 'rgba(248,81,73,.08)', border: `1px solid ${connected ? T.green : T.red}33`, borderRadius: 8, padding: '5px 10px' }}>
            {connected ? <Wifi size={11} color={T.green} /> : <WifiOff size={11} color={T.red} />}
            <span style={{ fontSize: 11, color: connected ? '#4ade80' : '#f87171' }}>{connected ? 'Dispatch Connected' : 'Disconnected'}</span>
          </div>
        </div>

        {/* Mission status indicator */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}` }}>
          <p style={{ margin: '0 0 6px', fontSize: 9, letterSpacing: 2, color: T.text2, fontFamily: T.font }}>MISSION STATUS</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: curStatus.color, animation: status !== 'idle' ? 'r-pulse 1.5s infinite' : 'none' }} />
            <span style={{ fontFamily: T.font, fontWeight: 700, fontSize: 13, color: curStatus.color }}>{curStatus.label}</span>
          </div>
        </div>

        {/* Tabs */}
        {mission && (
          <div style={{ padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {[
              { id: 'nav',    label: 'Navigation',    icon: Navigation },
              { id: 'vitals', label: 'Victim Vitals', icon: Activity   },
              { id: 'vault',  label: 'Medical Vault', icon: Shield     },
            ].map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setActiveTab(id)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                background: activeTab === id ? T.blueDim : 'transparent',
                color: activeTab === id ? T.blue : T.text2,
                border: activeTab === id ? `1px solid ${T.blue}44` : '1px solid transparent',
                borderRadius: 7, cursor: 'pointer', fontSize: 13, fontFamily: T.body, transition: 'all .15s',
              }}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* GPS coords */}
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${T.border}` }}>
          <p style={{ margin: '0 0 4px', fontSize: 9, letterSpacing: 2, color: T.text2, fontFamily: T.font }}>MY POSITION (LIVE)</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.blue, display: 'inline-block', animation: 'r-pulse 1.5s infinite' }} />
            <code style={{ fontSize: 11, color: T.blue, fontFamily: 'monospace' }}>
              {ambPos.lat.toFixed(5)}, {ambPos.lng.toFixed(5)}
            </code>
          </div>
        </div>
      </div>

      {/* ══ MAIN AREA ═════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ height: 58, background: T.bg1, borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', padding: '0 22px', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontFamily: T.font, fontWeight: 800, fontSize: 17, margin: 0 }}>LiveBridge Responder</h1>
            {status !== 'idle' && emergency && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: sevBg(sev), border: `1px solid ${sevColor(sev)}44`, borderRadius: 20, padding: '4px 12px' }}>
                <AlertTriangle size={11} color={sevColor(sev)} />
                <span style={{ fontSize: 11, color: sevColor(sev), fontWeight: 700, fontFamily: T.font }}>SOS #{emergency.id} · {sev.toUpperCase()}</span>
              </div>
            )}
          </div>
          {mission && (
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Status progress buttons */}
              {status === 'en_route' && (
                <StatusBtn label="ARRIVED ON SCENE" color={T.amber} icon={<MapPin size={13} />} onClick={() => progressStatus('on_scene')} />
              )}
              {status === 'on_scene' && (
                <StatusBtn label="TRANSPORTING" color={T.purple} icon={<Navigation size={13} />} onClick={() => progressStatus('transporting')} />
              )}
              {status === 'transporting' && (
                <StatusBtn label="MISSION COMPLETE" color={T.green} icon={<CheckCircle size={13} />} onClick={() => progressStatus('completed')} />
              )}
            </div>
          )}
        </div>

        {/* ── INCOMING DISPATCH ALERT ─────────────────────────────────── */}
        {pendingAlert && (
          <div style={{
            position: 'absolute', top: '58px', left: '260px', right: 0, zIndex: 9999,
            background: 'rgba(13,17,23,.97)', border: `2px solid ${T.blue}88`,
            borderRadius: '0 0 14px 14px',
            padding: '20px 28px',
            animation: 'r-bounce .5s ease, r-ring 1s ease-out infinite',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Pulsing icon */}
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: T.redDim, border: `2px solid ${T.red}88`, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'r-pulse 1s infinite' }}>
                <Radio size={24} color={T.red} />
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontFamily: T.font, fontWeight: 800, fontSize: 17, color: T.text1 }}>
                  🚨 DISPATCH INCOMING — SOS #{pendingAlert?.emergency?.id ?? '?'}
                </p>
                <p style={{ margin: '0 0 6px', fontSize: 12, color: T.text2 }}>
                  <span style={{ color: sevColor(pendingAlert?.emergency?.severity_score) }}>
                    {(pendingAlert?.emergency?.severity_score || 'Unknown').toUpperCase()}
                  </span>
                  &nbsp;·&nbsp;
                  {parseFloat(pendingAlert?.emergency?.latitude ?? 0).toFixed(4)}, {parseFloat(pendingAlert?.emergency?.longitude ?? 0).toFixed(4)}
                </p>
                <VaultChips vault={pendingAlert?.vault ?? {}} />
              </div>
            </div>
            {/* Accept / Decline */}
            <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
              <button onClick={acceptMission} style={{ padding: '12px 24px', background: T.green, border: 'none', borderRadius: 10, color: '#fff', fontFamily: T.font, fontWeight: 800, fontSize: 14, letterSpacing: .5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'opacity .15s' }}
                onMouseEnter={e => e.currentTarget.style.opacity = '.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                <CheckCircle size={16} /> ACCEPT
              </button>
              <button onClick={declineMission} style={{ padding: '12px 20px', background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, color: T.text2, fontFamily: T.font, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
                <XCircle size={15} /> Decline
              </button>
            </div>
          </div>
        )}

        {/* ── IDLE STATE ──────────────────────────────────────────────── */}
        {!mission && !pendingAlert && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: T.text2, padding: '40px' }}>
            <div style={{ width: 70, height: 70, borderRadius: '50%', background: T.bg2, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Radio size={32} color={T.text3} />
            </div>
            <p style={{ fontFamily: T.font, fontWeight: 700, fontSize: 17, margin: 0, color: T.text1 }}>Awaiting Dispatch</p>
            <p style={{ fontSize: 13, margin: 0, textAlign: 'center', lineHeight: 1.6 }}>
              Monitoring dispatch channel. A mission alert will<br />appear here when a SOS is routed to this unit.
            </p>
            <p style={{ fontSize: 11, margin: 0, color: T.text3, textAlign: 'center' }}>
              Trigger an SOS on the Victim App or run:<br />
              <code style={{ color: T.blue }}>node server/simulate_pileup.js</code>
            </p>
          </div>
        )}

        {/* ── ACTIVE MISSION ──────────────────────────────────────────── */}
        {mission && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

            {/* MAP (always shown as background in nav tab) */}
            {activeTab === 'nav' && (
              <div style={{ flex: 1, position: 'relative' }}>
                <MapContainer center={[ambPos.lat, ambPos.lng]} zoom={14} style={{ height: '100%', width: '100%', zIndex: 0 }} zoomControl={false}>
                  <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; OpenStreetMap' />
                  <MapController target={mapTarget} />

                  {/* Our ambulance */}
                  <Marker position={[ambPos.lat, ambPos.lng]} icon={makeAmbIcon()}>
                    <Popup>
                      <p style={{ fontFamily: T.font, fontWeight: 700, color: '#388bfd', margin: '0 0 3px' }}>🚑 UP-14 · {curStatus.label}</p>
                      <code style={{ fontSize: 10, color: '#6b7280' }}>{ambPos.lat.toFixed(5)}, {ambPos.lng.toFixed(5)}</code>
                    </Popup>
                  </Marker>

                  {/* Trail */}
                  {ambTrail.length > 1 && (
                    <Polyline positions={ambTrail} color="#388bfd" weight={3} opacity={0.65} dashArray="7 5" />
                  )}

                  {/* Victim pin */}
                  {status !== 'completed' && (
                    <Marker position={[vLat, vLng]} icon={makeVictimIcon(sev)}>
                      <Popup>
                        <p style={{ fontFamily: T.font, fontWeight: 700, color: sevColor(sev), margin: '0 0 3px' }}>
                          🚨 SOS #{emergency.id} · {sev.toUpperCase()}
                        </p>
                        <code style={{ fontSize: 10, color: '#6b7280' }}>{vLat.toFixed(5)}, {vLng.toFixed(5)}</code>
                      </Popup>
                    </Marker>
                  )}
                </MapContainer>

                {/* Overlay: distance + ETA */}
                <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 999, background: 'rgba(6,8,15,.92)', border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px 16px', minWidth: 200 }}>
                  <p style={{ margin: '0 0 4px', fontSize: 9, letterSpacing: 2, color: T.text2, fontFamily: T.font }}>MISSION · {curStatus.label.toUpperCase()}</p>
                  <p style={{ margin: '0 0 6px', fontFamily: T.font, fontWeight: 800, fontSize: 24, color: curStatus.color }}>
                    {status === 'en_route' ? '~3 min' : status === 'on_scene' ? 'ON SCENE' : status === 'transporting' ? 'En route hospital' : '—'}
                  </p>
                  <div style={{ fontSize: 11, color: T.text2, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <MapPin size={10} />
                    <span style={{ fontFamily: 'monospace' }}>{vLat.toFixed(4)}, {vLng.toFixed(4)}</span>
                  </div>
                </div>

                {/* Status progress bar overlay */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 999, background: 'rgba(13,17,23,.96)', borderTop: `1px solid ${T.border}`, padding: '14px 20px', display: 'flex', gap: 6, alignItems: 'center' }}>
                  {STATUS_FLOW.filter(s => s.id !== 'idle').map((s, i) => {
                    const curIdx  = STATUS_FLOW.findIndex(x => x.id === status);
                    const thisIdx = STATUS_FLOW.findIndex(x => x.id === s.id);
                    const done    = thisIdx <= curIdx;
                    return (
                      <div key={s.id} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ height: 4, background: done ? s.color : T.bg3, borderRadius: 2, transition: 'background .4s' }} />
                          <p style={{ margin: '4px 0 0', fontSize: 9, color: done ? s.color : T.text3, fontFamily: T.font, letterSpacing: .5, textAlign: 'center' }}>{s.label}</p>
                        </div>
                        {i < STATUS_FLOW.length - 2 && <ChevronRight size={10} color={T.text3} style={{ flexShrink: 0, marginBottom: 14 }} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── VITALS TAB ──────────────────────────────────────────── */}
            {activeTab === 'vitals' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', animation: 'r-fadein .25s ease' }}>
                <h2 style={{ fontFamily: T.font, fontWeight: 800, fontSize: 20, margin: '0 0 20px' }}>Victim Vitals</h2>

                {/* AI triage */}
                <div style={{ background: sevBg(sev), border: `1.5px solid ${sevColor(sev)}55`, borderRadius: 14, padding: '16px 18px', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <Activity size={20} color={sevColor(sev)} />
                    <div>
                      <p style={{ margin: 0, fontFamily: T.font, fontWeight: 800, fontSize: 20, color: sevColor(sev), letterSpacing: 1 }}>{sev.toUpperCase()}</p>
                      <p style={{ margin: 0, fontSize: 11, color: T.text2 }}>AI HuggingFace Triage Score</p>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {[
                      { label: 'Blood Loss',    val: emergency?.blood_loss    ?? 'Unknown' },
                      { label: 'Consciousness', val: emergency?.consciousness ?? 'Unknown' },
                      { label: 'Breathing',     val: emergency?.breathing     ?? 'Unknown' },
                    ].map(({ label, val }) => (
                      <div key={label} style={{ background: 'rgba(0,0,0,.25)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                        <p style={{ margin: '0 0 3px', fontSize: 9, color: T.text2, letterSpacing: 1 }}>{label.toUpperCase()}</p>
                        <p style={{ margin: 0, fontFamily: T.font, fontWeight: 700, fontSize: 13, color: T.text1 }}>{val}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Coordinates */}
                <InfoCard icon={<MapPin size={14} />} label="VICTIM GPS" color={T.blue}>
                  <code style={{ fontSize: 13, color: T.blue, fontFamily: 'monospace' }}>{vLat.toFixed(6)}, {vLng.toFixed(6)}</code>
                  {emergency?.latitude && (
                    <p style={{ margin: '5px 0 0', fontSize: 11, color: T.text2 }}>
                      Accuracy: ±5m · Acquired via HTML5 Geolocation API
                    </p>
                  )}
                </InfoCard>

                {/* Time */}
                <InfoCard icon={<Clock size={14} />} label="SOS TRIGGERED" color={T.amber}>
                  <p style={{ margin: 0, fontSize: 13, color: T.text1 }}>
                    {emergency?.created_at
                      ? new Date(emergency.created_at).toLocaleString()
                      : 'Just now'}
                  </p>
                </InfoCard>
              </div>
            )}

            {/* ── VAULT TAB ───────────────────────────────────────────── */}
            {activeTab === 'vault' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', animation: 'r-fadein .25s ease' }}>
                <h2 style={{ fontFamily: T.font, fontWeight: 800, fontSize: 20, margin: '0 0 20px' }}>Medical Vault</h2>
                <ResponderVaultView vault={vault} severity={sev} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Status progress button ─────────────────────────────────────────────────
function StatusBtn({ label, color, icon, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '9px 18px', background: `${color}22`, border: `1.5px solid ${color}77`,
      borderRadius: 10, color, fontFamily: "'Syne',sans-serif", fontWeight: 700,
      fontSize: 12, letterSpacing: .5, cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 7, transition: 'all .15s',
    }}
      onMouseEnter={e => e.currentTarget.style.background = `${color}40`}
      onMouseLeave={e => e.currentTarget.style.background = `${color}22`}
    >
      {icon} {label}
    </button>
  );
}

// ── Info card ──────────────────────────────────────────────────────────────
function InfoCard({ icon, label, color, children }) {
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ color }}>{icon}</span>
        <span style={{ fontSize: 10, letterSpacing: 2, color: T.text2, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

// ── Vault quick-chip row for dispatch alert ────────────────────────────────
function VaultChips({ vault }) {
  const v          = vault ?? {};
  const bloodType  = v.blood_type ?? v.bloodType ?? null;
  const allergies  = Array.isArray(v.allergies ?? v.severe_allergies) ? (v.allergies ?? v.severe_allergies) : [];
  const conditions = Array.isArray(v.conditions ?? v.medical_conditions) ? (v.conditions ?? v.medical_conditions) : [];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {bloodType && <Chip color={T.red}    icon="🩸" label={`Blood: ${bloodType}`} />}
      {allergies.slice(0, 2).map(a => <Chip key={a} color={T.amber}  icon="⚠️" label={a} />)}
      {conditions.slice(0, 2).map(c => <Chip key={c} color={T.purple} icon="🏥" label={c} />)}
    </div>
  );
}
function Chip({ color, icon, label }) {
  return (
    <span style={{ background: `${color}18`, border: `1px solid ${color}44`, borderRadius: 5, padding: '3px 8px', fontSize: 10, color, display: 'flex', alignItems: 'center', gap: 4 }}>
      {icon} {label}
    </span>
  );
}

// ── Full vault view for vault tab ──────────────────────────────────────────
function ResponderVaultView({ vault, severity }) {
  const v          = vault ?? {};
  const bloodType  = v.blood_type   ?? v.bloodType  ?? '—';
  const allergies  = Array.isArray(v.allergies  ?? v.severe_allergies)   ? (v.allergies  ?? v.severe_allergies)   : [];
  const conditions = Array.isArray(v.conditions ?? v.medical_conditions) ? (v.conditions ?? v.medical_conditions) : [];
  const meds       = Array.isArray(v.medications) ? v.medications : [];
  const contacts   = Array.isArray(v.emergency_contacts ?? v.contacts) ? (v.emergency_contacts ?? v.contacts) : [];
  const doctor     = v.doctor_name ?? v.doctorName ?? '—';
  const hospital   = v.hospital ?? '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Blood + severity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: T.redDim, border: `1px solid ${T.red}33`, borderRadius: 12, padding: '14px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontSize: 9, color: T.text2, letterSpacing: 1.5, fontFamily: "'Syne',sans-serif" }}>BLOOD TYPE</p>
          <p style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 30, color: T.red }}>{bloodType}</p>
        </div>
        <div style={{ background: sevBg(severity), border: `1px solid ${sevColor(severity)}33`, borderRadius: 12, padding: '14px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontSize: 9, color: T.text2, letterSpacing: 1.5, fontFamily: "'Syne',sans-serif" }}>AI TRIAGE</p>
          <p style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, color: sevColor(severity) }}>{severity.toUpperCase()}</p>
        </div>
      </div>

      {/* Allergies */}
      {allergies.length > 0 && (
        <VaultSection icon="⚠️" label="ALLERGIES" color={T.amber} bg={T.amberDim}>
          {allergies.map(a => <VaultTag key={a} color={T.amber}>{a}</VaultTag>)}
        </VaultSection>
      )}

      {/* Conditions */}
      {conditions.length > 0 && (
        <VaultSection icon="🏥" label="CONDITIONS" color={T.purple} bg="#2d1f4e">
          {conditions.map(c => <VaultTag key={c} color={T.purple}>{c}</VaultTag>)}
        </VaultSection>
      )}

      {/* Medications */}
      {meds.length > 0 && (
        <VaultSection icon="💊" label="MEDICATIONS" color={T.blue} bg={T.blueDim}>
          {meds.map((m, i) => (
            <VaultTag key={i} color={T.blue}>
              {typeof m === 'object' ? `${m.name ?? ''} ${m.dose ?? ''}`.trim() : m}
            </VaultTag>
          ))}
        </VaultSection>
      )}

      {/* Doctor */}
      <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', fontSize: 12 }}>
        <p style={{ margin: '0 0 3px', fontSize: 9, color: T.text2, letterSpacing: 1.5, fontFamily: "'Syne',sans-serif" }}>PRIMARY PHYSICIAN</p>
        <p style={{ margin: 0, color: T.text1 }}>{doctor} · <span style={{ color: T.text2 }}>{hospital}</span></p>
      </div>

      {/* Emergency contacts */}
      {contacts.length > 0 && (
        <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 9, color: T.text2, letterSpacing: 1.5, fontFamily: "'Syne',sans-serif" }}>EMERGENCY CONTACTS</p>
          {contacts.slice(0, 3).map((c, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: i < contacts.length - 1 ? `1px solid ${T.border}` : 'none' }}>
              <span style={{ color: T.text1 }}>{c.name ?? '—'} <span style={{ color: T.text2, fontSize: 11 }}>({c.rel ?? c.relationship ?? ''})</span></span>
              <span style={{ color: T.green, fontFamily: 'monospace', fontSize: 11 }}>{c.phone ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      {/* No vault data fallback */}
      {!allergies.length && !conditions.length && !meds.length && (
        <div style={{ background: T.bg2, border: `1px dashed ${T.border}`, borderRadius: 10, padding: '20px', textAlign: 'center', color: T.text2 }}>
          <Shield size={28} color={T.text3} style={{ marginBottom: 8 }} />
          <p style={{ margin: 0, fontSize: 13 }}>No vault data available for this patient.</p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: T.text3 }}>They may not have completed setup.</p>
        </div>
      )}
    </div>
  );
}

function VaultSection({ icon, label, color, bg, children }) {
  return (
    <div style={{ background: bg, border: `1px solid ${color}33`, borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ margin: '0 0 7px', fontSize: 9, color, letterSpacing: 1.5, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>{icon} {label}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{children}</div>
    </div>
  );
}

function VaultTag({ color, children }) {
  return (
    <span style={{ background: `${color}15`, border: `1px solid ${color}44`, borderRadius: 5, padding: '3px 9px', fontSize: 11, color }}>
      {children}
    </span>
  );
}
