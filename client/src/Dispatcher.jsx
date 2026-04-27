// src/Dispatcher.jsx — LiveBridge Command Center (Presentation Edition)
// ✅ Hospital routing dropdown → emits route_to_hospital
// ✅ Audio ping (Web Audio API) on new_emergency
// ✅ Live ambulance tracking: map follows responder_location_update + trail polyline
// ✅ Animated Audit Trail with real-time build-up
// ✅ All 4 nav tabs functional

import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import {
  LayoutDashboard, Map as MapIcon, Users, Truck, LogOut, Ambulance,
  Radio, AlertTriangle, CheckCircle, Clock, MapPin, Activity,
  ChevronRight, X, Navigation, Volume2, VolumeX, Wifi, WifiOff,
  TrendingUp, Bell, Route,
} from 'lucide-react';

// ── Leaflet icon fix for Vite ──────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Icon factories ─────────────────────────────────────────────────────────
function makeSOSIcon(severity) {
  const color = severity === 'Critical' ? '#f85149' : severity === 'High' ? '#d29922' : '#3fb950';
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46">
      <defs><filter id="g"><feGaussianBlur stdDeviation="2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <ellipse cx="19" cy="42" rx="7" ry="3" fill="rgba(0,0,0,.3)"/>
      <path d="M19 0C8.5 0 0 8.5 0 19C0 31.5 19 46 19 46S38 31.5 38 19C38 8.5 29.5 0 19 0Z"
            fill="${color}" filter="url(#g)"/>
      <circle cx="19" cy="19" r="11" fill="rgba(255,255,255,0.12)"/>
      <text x="19" y="24" text-anchor="middle" font-family="Syne,sans-serif"
            font-size="10" font-weight="800" fill="white" letter-spacing="1">SOS</text>
    </svg>`,
    className: '', iconSize: [38, 46], iconAnchor: [19, 46], popupAnchor: [0, -46],
  });
}

function makeAmbIcon() {
  return L.divIcon({
    html: `<div style="background:#388bfd;border-radius:10px;width:34px;height:34px;
           display:flex;align-items:center;justify-content:center;
           border:2px solid #fff;box-shadow:0 0 18px rgba(56,139,253,.9)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
        <rect x="1" y="3" width="15" height="13" rx="1"/>
        <path d="M16 8h4l3 3v5h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/>
        <circle cx="18.5" cy="18.5" r="2.5"/>
      </svg></div>`,
    className: '', iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -34],
  });
}

// ── Smooth-moving ambulance marker ────────────────────────────────────────
// Part 2 Client: Instead of destroying/recreating the Marker every GPS update
// (which causes the jump-erratically bug), we hold a Leaflet marker ref and
// call marker.setLatLng() directly — Leaflet interpolates the icon smoothly.
function SmoothAmbulanceMarker({ position }) {
  const markerRef = useRef(null);
  const map       = useMap();

  useEffect(() => {
    if (!position) return;
    const latlng = [position.lat, position.lng];

    if (!markerRef.current) {
      // First appearance — create marker and add to map
      markerRef.current = L.marker(latlng, { icon: makeAmbIcon() }).addTo(map);
      markerRef.current.bindPopup(
        `<div style="font-family:'DM Sans',sans-serif">
          <p style="font-family:'Syne',sans-serif;font-weight:700;color:#388bfd;margin:0 0 3px">🚑 UP-14 LIVE</p>
          <code style="font-size:10px;color:#6b7280">${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}</code>
        </div>`
      );
    } else {
      // Subsequent updates — move without recreating (no jump)
      markerRef.current.setLatLng(latlng);
      // Update popup content with fresh coords
      markerRef.current.getPopup()?.setContent(
        `<div style="font-family:'DM Sans',sans-serif">
          <p style="font-family:'Syne',sans-serif;font-weight:700;color:#388bfd;margin:0 0 3px">🚑 UP-14 LIVE</p>
          <code style="font-size:10px;color:#6b7280">${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}</code>
        </div>`
      );
    }
  }, [position, map]);

  // Remove marker from map when component unmounts
  useEffect(() => {
    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, []);

  return null; // renders nothing — Leaflet manages the DOM element directly
}

// ── Map auto-pan controller ────────────────────────────────────────────────
function MapController({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom ?? 15, { duration: 1.2, easeLinearity: 0.4 });
  }, [target, map]);
  return null;
}

// ── Design tokens ──────────────────────────────────────────────────────────
const D = {
  bg0: '#060b14', bg1: '#0d1524', bg2: '#111e33', bg3: '#162540',
  border: '#1e3050', text1: '#e2e8f0', text2: '#64748b', text3: '#334155',
  red: '#f85149', amber: '#d29922', green: '#3fb950', blue: '#388bfd',
  font: "'Syne', sans-serif", body: "'DM Sans', sans-serif",
};
const sevColor = (s) => s === 'Critical' ? D.red : s === 'High' ? D.amber : D.green;
const sevBg    = (s) => s === 'Critical' ? 'rgba(248,81,73,.1)' : s === 'High' ? 'rgba(210,153,34,.1)' : 'rgba(63,185,80,.1)';
const fmtTs = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ── Nearby hospitals (routing dropdown) ───────────────────────────────────
const HOSPITALS = [
  { id: 'apollo_chennai',  label: 'Apollo Hospitals, Chennai',     lat: 13.0732, lng: 80.2609, dist: '2.1 km', eta: 4 },
  { id: 'srm_hospital',    label: 'SRM Medical College Hospital',   lat: 12.8231, lng: 80.0442, dist: '1.2 km', eta: 3 },
  { id: 'fortis_chennai',  label: 'Fortis Malar Hospital',          lat: 13.0000, lng: 80.2547, dist: '3.8 km', eta: 7 },
  { id: 'miot_chennai',    label: 'MIOT International Hospital',    lat: 13.0104, lng: 80.1943, dist: '5.4 km', eta: 9 },
];

// ── Web Audio API alert beep ───────────────────────────────────────────────
function playBeep(type = 'sos') {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === 'sos') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523, ctx.currentTime);
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (_) { /* blocked before user interaction — safe to ignore */ }
}

// ── Audit trail builder ────────────────────────────────────────────────────
function buildAudit(emergency) {
  if (!emergency) return [];
  const base = new Date(emergency.created_at).getTime();
  const sev  = (emergency.severity_score || 'Unknown').toUpperCase();
  const sc   = emergency.severity_score === 'Critical' ? D.red
             : emergency.severity_score === 'High'     ? D.amber : D.green;
  const events = [
    { delta: 0,    icon: '🚨', label: 'SOS Triggered by Victim',              color: D.red   },
    { delta: 1100, icon: '📡', label: 'GPS Signal Acquired (±5m)',             color: D.blue  },
    { delta: 2300, icon: '🔐', label: 'Medical Vault Decrypted & Sent',        color: '#a78bfa' },
    { delta: 3800, icon: '🧠', label: `AI Triage Engine: ${sev}`,              color: sc      },
    { delta: 4600, icon: '📋', label: 'Dispatcher Notified via Socket.io',     color: D.blue  },
    { delta: 5900, icon: '🚑', label: 'Ambulance UP-14 Dispatched',            color: D.green },
    { delta: 7200, icon: '📱', label: 'SMS to Emergency Contacts',             color: D.amber },
    { delta: 8400, icon: '🏥', label: 'Hospital Dashboard Notified',           color: D.blue  },
  ];
  const now = Date.now();
  return events
    .filter(ev => base + ev.delta <= now)
    .map(ev => ({ ...ev, ts: new Date(base + ev.delta) }));
}

// ═══════════════════════════════════════════════════════════════════════════
export default function Dispatcher() {
  const [activeTab,      setActiveTab]      = useState('Map View');
  const [emergencies,    setEmergencies]    = useState([]);
  const [selected,       setSelected]       = useState(null);    // full emergency obj
  const [latestSOS,      setLatestSOS]      = useState(null);
  const [connected,      setConnected]      = useState(false);
  const [victimPings,    setVictimPings]    = useState({});      // {id: {lat,lng}}
  const [responderPos,   setResponderPos]   = useState(null);    // {lat,lng,emergency_id}
  const [responderTrail, setResponderTrail] = useState([]);      // [[lat,lng],…]
  const [mapTarget,      setMapTarget]      = useState(null);
  const [audioOn,        setAudioOn]        = useState(true);
  const [routeOpen,      setRouteOpen]      = useState(false);
  const [routedHosp,     setRoutedHosp]     = useState(null);    // {…hospital, emergency_id}
  const [auditEvents,    setAuditEvents]    = useState([]);
  const [newAlert,       setNewAlert]       = useState(false);

  const socketRef    = useRef(null);
  const audioOnRef   = useRef(true);      // ref mirror so socket handler sees current value
  const auditTimerRef = useRef(null);

  useEffect(() => { audioOnRef.current = audioOn; }, [audioOn]);

  // ── Audit trail live refresh ─────────────────────────────────────────────
  useEffect(() => {
    if (!selected) { setAuditEvents([]); return; }
    const tick = () => setAuditEvents(buildAudit(selected));
    tick();
    auditTimerRef.current = setInterval(tick, 1000);
    return () => clearInterval(auditTimerRef.current);
  }, [selected?.id, selected?.created_at]);

  // ── Socket.io setup ──────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io('http://localhost:8000');
    socketRef.current = socket;

    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('new_emergency', (e) => {
      setEmergencies(prev => [e, ...prev]);
      setLatestSOS(e);
      setMapTarget({ lat: parseFloat(e.latitude), lng: parseFloat(e.longitude), zoom: 15 });
      setNewAlert(true);
      setTimeout(() => setNewAlert(false), 4000);
      if (audioOnRef.current) playBeep('sos');
    });

    socket.on('emergency_resolved', ({ id }) => {
      setEmergencies(prev => prev.filter(e => e.id !== id));
      setSelected(prev => prev?.id === id ? null : prev);
    });

    socket.on('victim_location_update', ({ emergency_id, latitude, longitude }) => {
      setVictimPings(prev => ({
        ...prev,
        [emergency_id]: { lat: parseFloat(latitude), lng: parseFloat(longitude) },
      }));
    });

    // 🚑 Live ambulance GPS → pan map + draw trail
    socket.on('responder_location_update', ({ latitude, longitude, emergency_id }) => {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      setResponderPos({ lat, lng, emergency_id });
      setResponderTrail(prev => [...prev.slice(-100), [lat, lng]]);
      setMapTarget({ lat, lng, zoom: 15 });   // smooth pan
    });

    return () => socket.disconnect();
  }, []);

  // ── Initial fetch ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('http://localhost:8000/api/emergencies')
      .then(r => r.json()).then(setEmergencies).catch(console.error);
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resolveEmergency = useCallback(async (id) => {
    try { await fetch(`http://localhost:8000/api/emergencies/${id}/resolve`, { method: 'PATCH' }); }
    catch (err) { console.error(err); }
  }, []);

  const routeToHospital = useCallback((hospital) => {
    if (!selected || !socketRef.current) return;
    socketRef.current.emit('route_to_hospital', {
      emergency_id:  selected.id,
      hospital_id:   hospital.id,
      hospital_name: hospital.label,
      hospital_lat:  hospital.lat,
      hospital_lng:  hospital.lng,
      eta_minutes:   hospital.eta,
    });
    setRoutedHosp({ ...hospital, emergency_id: selected.id });
    setRouteOpen(false);
    playBeep('confirm');
    console.log(`✅ SOS #${selected.id} → ${hospital.label} (${hospital.eta} min ETA)`);
  }, [selected]);

  const critical = emergencies.filter(e => e.severity_score === 'Critical').length;

  const navItems = [
    { name: 'Dashboard',      icon: LayoutDashboard },
    { name: 'Map View',       icon: MapIcon },
    { name: 'Victims List',   icon: Users },
    { name: 'Ambulance List', icon: Truck },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: D.bg0, color: D.text1, fontFamily: D.body }}>
      <style>{`
        @keyframes d-pulse  { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes d-fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        @keyframes d-slide  { from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:none} }
        @keyframes d-ring   { 0%{box-shadow:0 0 0 0 rgba(248,81,73,.6)} 70%{box-shadow:0 0 0 14px rgba(248,81,73,0)} 100%{box-shadow:0 0 0 0 rgba(248,81,73,0)} }
      `}</style>

      {/* ══ LEFT SIDEBAR ══════════════════════════════════════════════════ */}
      <div style={{ width: 258, background: D.bg1, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${D.border}`, flexShrink: 0 }}>

        {/* Logo */}
        <div style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${D.border}` }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: '#1e2a45', border: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ambulance size={18} color={D.blue} />
          </div>
          <div>
            <p style={{ margin: 0, fontFamily: D.font, fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>LIVEBRIDGE</p>
            <p style={{ margin: 0, fontSize: 9, color: D.text2, letterSpacing: 1 }}>COMMAND CENTER</p>
          </div>
        </div>

        {/* Nav */}
        <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {navItems.map(({ name, icon: Icon }) => {
            const active = activeTab === name;
            return (
              <button key={name} onClick={() => setActiveTab(name)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px',
                background: active ? '#1e3a5f' : 'transparent', color: active ? '#60a5fa' : D.text2,
                border: active ? '1px solid #2a4f7f' : '1px solid transparent',
                borderRadius: 7, cursor: 'pointer', fontSize: 13, fontFamily: D.body, textAlign: 'left', transition: 'all .15s',
              }}>
                <Icon size={15} /> {name}
              </button>
            );
          })}
        </div>

        {/* Active SOS list */}
        <div style={{ flex: 1, padding: '0 10px', borderTop: `1px solid ${D.border}`, overflowY: 'auto' }}>
          <p style={{ margin: '12px 4px 8px', fontSize: 9, letterSpacing: 2, color: D.text2, fontFamily: D.font }}>ACTIVE SOS ({emergencies.length})</p>
          {emergencies.length === 0 && <p style={{ fontSize: 12, color: D.text2, textAlign: 'center', padding: '12px 0' }}>No active emergencies</p>}
          {emergencies.map(e => (
            <div key={e.id}
              onClick={() => { setSelected(e); setActiveTab('Map View'); setMapTarget({ lat: parseFloat(e.latitude), lng: parseFloat(e.longitude), zoom: 15 }); }}
              style={{ background: selected?.id === e.id ? '#1e2d45' : D.bg2, border: `1px solid ${selected?.id === e.id ? D.border : 'transparent'}`, borderRadius: 9, padding: '10px 12px', marginBottom: 6, cursor: 'pointer', transition: 'all .15s' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontFamily: D.font, fontWeight: 700, fontSize: 12 }}>SOS #{e.id}</span>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: sevColor(e.severity_score), background: sevBg(e.severity_score), border: `1px solid ${sevColor(e.severity_score)}33`, borderRadius: 4, padding: '2px 6px', fontFamily: D.font }}>
                  {(e.severity_score || 'UNKNOWN').toUpperCase()}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: D.text2, marginBottom: 6 }}>
                <Clock size={10} /> {new Date(e.created_at).toLocaleTimeString()}
              </div>
              <button onClick={ev => { ev.stopPropagation(); resolveEmergency(e.id); }} style={{ width: '100%', padding: '5px 0', background: 'transparent', border: `1px solid ${D.border}`, borderRadius: 6, color: D.text2, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontFamily: D.body }}>
                <CheckCircle size={11} /> Mark Resolved
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${D.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: D.bg3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>RS</div>
            <div>
              <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>Rohan Shaw</p>
              <p style={{ margin: 0, fontSize: 11, color: D.green }}>● Online</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setAudioOn(a => !a)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, background: D.bg2, border: `1px solid ${D.border}`, borderRadius: 6, color: audioOn ? D.amber : D.text2, fontSize: 11, padding: '5px 8px', cursor: 'pointer', fontFamily: D.body }}>
              {audioOn ? <Volume2 size={13} /> : <VolumeX size={13} />}
              {audioOn ? 'Audio On' : 'Audio Off'}
            </button>
            <button style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: `1px solid ${D.border}`, borderRadius: 6, color: D.text2, fontSize: 11, padding: '5px 10px', cursor: 'pointer', fontFamily: D.body }}>
              <LogOut size={13} /> Exit
            </button>
          </div>
        </div>
      </div>

      {/* ══ MAIN AREA ═════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ height: 60, background: D.bg1, borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', padding: '0 22px', justifyContent: 'space-between', flexShrink: 0, zIndex: 1000 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontFamily: D.font, fontWeight: 700, fontSize: 17, margin: 0 }}>LiveBridge Dispatch</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: connected ? '#0d1a0d' : '#1a0d0d', border: `1px solid ${connected ? '#1a2d1a' : '#2d1a1a'}`, borderRadius: 20, padding: '4px 10px' }}>
              {connected ? <Wifi size={11} color={D.green} /> : <WifiOff size={11} color={D.red} />}
              <span style={{ fontSize: 11, color: connected ? '#4ade80' : '#f87171' }}>{connected ? 'Live' : 'Reconnecting...'}</span>
            </div>
            {newAlert && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(248,81,73,.15)', border: `1px solid rgba(248,81,73,.4)`, borderRadius: 20, padding: '4px 10px', animation: 'd-fadein .3s ease' }}>
                <Bell size={11} color={D.red} style={{ animation: 'd-pulse 0.8s infinite' }} />
                <span style={{ fontSize: 11, color: D.red, fontWeight: 700 }}>NEW SOS</span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {critical > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(248,81,73,.1)', border: '1px solid rgba(248,81,73,.3)', borderRadius: 8, padding: '5px 12px' }}>
                <AlertTriangle size={13} color={D.red} />
                <span style={{ fontSize: 13, color: '#f87171', fontWeight: 500 }}>{critical} Critical</span>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: D.bg2, border: `1px solid ${D.border}`, borderRadius: 8, padding: '5px 12px' }}>
              <Radio size={13} color={D.blue} />
              <span style={{ fontSize: 13, color: '#60a5fa', fontWeight: 500 }}>{emergencies.length} Active</span>
            </div>
            {responderPos && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(63,185,80,.1)', border: '1px solid rgba(63,185,80,.3)', borderRadius: 8, padding: '5px 12px' }}>
                <Navigation size={13} color={D.green} style={{ animation: 'd-pulse 1.5s infinite' }} />
                <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700 }}>AMB LIVE</span>
              </div>
            )}
          </div>
        </div>

        {/* Tab content + optional right sidebar */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── DASHBOARD ────────────────────────────────────────────────── */}
          {activeTab === 'Dashboard' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', background: D.bg0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
                {[
                  { label: 'Active SOS',  val: emergencies.length,                                               color: D.blue,  icon: <Radio size={20} /> },
                  { label: 'Critical',    val: emergencies.filter(e => e.severity_score === 'Critical').length,   color: D.red,   icon: <AlertTriangle size={20} /> },
                  { label: 'High',        val: emergencies.filter(e => e.severity_score === 'High').length,       color: D.amber, icon: <TrendingUp size={20} /> },
                  { label: 'Units Live',  val: responderPos ? 1 : 0,                                              color: D.green, icon: <Navigation size={20} /> },
                ].map(({ label, val, color, icon }) => (
                  <div key={label} style={{ background: D.bg1, border: `1px solid ${D.border}`, borderRadius: 12, padding: '18px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: D.text2, letterSpacing: 1, fontFamily: D.font }}>{label.toUpperCase()}</span>
                      <span style={{ color }}>{icon}</span>
                    </div>
                    <span style={{ fontFamily: D.font, fontWeight: 800, fontSize: 34, color }}>{val}</span>
                  </div>
                ))}
              </div>
              <PlaceholderCard title="📊 Live Heatmap" desc="SOS density overlay across the city grid." />
              <PlaceholderCard title="📈 Response Time Graph" desc="Average paramedic arrival time — last 24 hours." />
            </div>
          )}

          {/* ── VICTIMS LIST ──────────────────────────────────────────────── */}
          {activeTab === 'Victims List' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', background: D.bg0 }}>
              <h2 style={{ fontFamily: D.font, fontWeight: 800, fontSize: 20, margin: '0 0 20px' }}>Active Victims</h2>
              {emergencies.length === 0 && <PlaceholderCard title="All Clear" desc="No active SOS signals at this time." />}
              {emergencies.map((e, i) => (
                <div key={e.id} style={{ background: D.bg1, border: `1px solid ${D.border}`, borderRadius: 10, padding: '14px 18px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ fontFamily: D.font, fontWeight: 700, fontSize: 12, color: D.text2 }}>#{i + 1}</span>
                    <div>
                      <p style={{ margin: 0, fontFamily: D.font, fontWeight: 700, fontSize: 13 }}>SOS #{e.id}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: D.text2 }}>{new Date(e.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <code style={{ fontSize: 11, color: D.text2 }}>{parseFloat(e.latitude).toFixed(4)}, {parseFloat(e.longitude).toFixed(4)}</code>
                    <span style={{ fontSize: 9, fontWeight: 700, color: sevColor(e.severity_score), background: sevBg(e.severity_score), border: `1px solid ${sevColor(e.severity_score)}44`, borderRadius: 5, padding: '3px 8px', fontFamily: D.font, letterSpacing: .5 }}>
                      {(e.severity_score || 'UNKNOWN').toUpperCase()}
                    </span>
                    <button onClick={() => resolveEmergency(e.id)} style={{ background: '#0d1a0d', border: '1px solid #1a2d1a', borderRadius: 6, color: '#4ade80', fontSize: 11, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: D.body }}>
                      <CheckCircle size={11} /> Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── AMBULANCE LIST ────────────────────────────────────────────── */}
          {activeTab === 'Ambulance List' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', background: D.bg0 }}>
              <h2 style={{ fontFamily: D.font, fontWeight: 800, fontSize: 20, margin: '0 0 20px' }}>Ambulance Fleet</h2>
              {[
                { unit: 'UP-14', type: 'ALS Unit', status: responderPos ? 'En Route' : 'Available', color: responderPos ? D.blue : D.green },
                { unit: 'UP-07', type: 'BLS Unit', status: 'Available',  color: D.green },
                { unit: 'UP-22', type: 'ALS Unit', status: 'On Scene',   color: D.amber },
              ].map(u => (
                <div key={u.unit} style={{ background: D.bg1, border: `1px solid ${D.border}`, borderRadius: 10, padding: '14px 18px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: '#1e3a5f', border: '1px solid #2a4f7f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Ambulance size={17} color="#60a5fa" />
                    </div>
                    <div>
                      <p style={{ margin: 0, fontFamily: D.font, fontWeight: 700, fontSize: 14 }}>{u.unit}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: D.text2 }}>{u.type}</p>
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: u.color, background: `${u.color}18`, border: `1px solid ${u.color}33`, borderRadius: 6, padding: '4px 10px', fontFamily: D.font, letterSpacing: .5 }}>
                    {u.status.toUpperCase()}
                  </span>
                </div>
              ))}
              <PlaceholderCard title="🗺️ Fleet Map" desc="Live GPS overlay of all ambulance units." />
            </div>
          )}

          {/* ── MAP VIEW ──────────────────────────────────────────────────── */}
          {activeTab === 'Map View' && (
            <div style={{ flex: 1, position: 'relative' }}>
              <MapContainer center={[13.0827, 80.2707]} zoom={12} style={{ height: '100%', width: '100%', zIndex: 0 }} zoomControl={false}>
                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; OpenStreetMap' />
                <MapController target={mapTarget} />

                {/* SOS markers */}
                {emergencies.map(e => {
                  const lat = victimPings[e.id]?.lat ?? parseFloat(e.latitude);
                  const lng = victimPings[e.id]?.lng ?? parseFloat(e.longitude);
                  return (
                    <Marker key={e.id} position={[lat, lng]} icon={makeSOSIcon(e.severity_score)}
                      eventHandlers={{ click: () => { setSelected(e); setMapTarget({ lat, lng, zoom: 15 }); } }}>
                      <Popup>
                        <div style={{ fontFamily: D.body, minWidth: 160 }}>
                          <p style={{ fontFamily: D.font, fontWeight: 700, fontSize: 13, color: sevColor(e.severity_score), margin: '0 0 5px' }}>
                            SOS #{e.id} — {(e.severity_score || 'Unknown').toUpperCase()}
                          </p>
                          <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 8px' }}>{new Date(e.created_at).toLocaleTimeString()}</p>
                          <button onClick={() => resolveEmergency(e.id)} style={{ width: '100%', padding: '5px 0', background: '#166534', color: '#4ade80', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                            ✓ Mark Resolved
                          </button>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}

                {/* 🚑 Smooth ambulance marker — setLatLng() instead of React re-render = no jumping */}
                {responderPos && (
                  <SmoothAmbulanceMarker position={responderPos} />
                )}

                {/* Ambulance trail */}
                {responderTrail.length > 1 && (
                  <Polyline positions={responderTrail} color="#388bfd" weight={3} opacity={0.65} dashArray="7 5" />
                )}
              </MapContainer>

              {/* Live location badge */}
              {responderPos && (
                <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 999, background: 'rgba(6,11,20,.94)', border: '1px solid rgba(56,139,253,.4)', borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: D.blue, display: 'inline-block', animation: 'd-pulse 1.5s infinite' }} />
                  <span style={{ fontSize: 12, color: '#60a5fa', fontFamily: D.font, fontWeight: 700 }}>
                    UP-14 · {responderPos.lat.toFixed(4)}, {responderPos.lng.toFixed(4)}
                  </span>
                </div>
              )}

              {/* Empty state */}
              {emergencies.length === 0 && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(13,21,36,.88)', border: `1px solid ${D.border}`, borderRadius: 14, padding: '24px 32px', textAlign: 'center', zIndex: 999, pointerEvents: 'none' }}>
                  <CheckCircle size={30} color={D.green} style={{ marginBottom: 10 }} />
                  <p style={{ fontFamily: D.font, fontWeight: 700, fontSize: 15, margin: '0 0 5px' }}>All Clear</p>
                  <p style={{ fontSize: 12, color: D.text2, margin: 0 }}>Monitoring live. No active SOS.</p>
                </div>
              )}
            </div>
          )}

          {/* ══ RIGHT SIDEBAR — Mission Details ════════════════════════════ */}
          {selected && activeTab === 'Map View' && (
            <div style={{ width: 318, background: D.bg1, borderLeft: `1px solid ${D.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'd-slide .25s ease', flexShrink: 0 }}>

              {/* Header */}
              <div style={{ padding: '15px 18px', borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ margin: 0, fontFamily: D.font, fontWeight: 800, fontSize: 14 }}>SOS #{selected.id}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 10, color: D.text2 }}>Mission Details</p>
                </div>
                <button onClick={() => setSelected(null)} style={{ background: D.bg2, border: `1px solid ${D.border}`, borderRadius: '50%', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: D.text2 }}>
                  <X size={12} />
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Severity */}
                <div style={{ background: sevBg(selected.severity_score), border: `1px solid ${sevColor(selected.severity_score)}33`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Activity size={16} color={sevColor(selected.severity_score)} />
                    <div>
                      <p style={{ margin: 0, fontFamily: D.font, fontWeight: 800, fontSize: 16, color: sevColor(selected.severity_score), letterSpacing: 1 }}>
                        {(selected.severity_score || 'UNKNOWN').toUpperCase()}
                      </p>
                      <p style={{ margin: 0, fontSize: 10, color: D.text2 }}>AI Triage Score</p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontSize: 11 }}>{new Date(selected.created_at).toLocaleTimeString()}</p>
                    <p style={{ margin: 0, fontSize: 10, color: D.text2 }}>Triggered</p>
                  </div>
                </div>

                {/* Location */}
                <SideSection title="Location" icon={<MapPin size={12} />}>
                  <code style={{ display: 'block', fontFamily: 'monospace', fontSize: 12, background: D.bg2, border: `1px solid ${D.border}`, borderRadius: 7, padding: '8px 10px', lineHeight: 1.7 }}>
                    {victimPings[selected.id]
                      ? <><span style={{ color: D.green, fontSize: 10 }}>● LIVE&nbsp;</span>{victimPings[selected.id].lat.toFixed(5)}, {victimPings[selected.id].lng.toFixed(5)}</>
                      : `${parseFloat(selected.latitude).toFixed(5)}, ${parseFloat(selected.longitude).toFixed(5)}`
                    }
                  </code>
                </SideSection>

                {/* ── HOSPITAL ROUTING ──────────────────────────────────────── */}
                <SideSection title="Route to Hospital" icon={<Route size={12} />} accent={D.green}>
                  <div style={{ position: 'relative' }}>
                    {/* Dropdown trigger */}
                    <button
                      onClick={() => setRouteOpen(r => !r)}
                      style={{ width: '100%', padding: '10px 13px', background: D.bg2, border: `1px solid ${routeOpen ? D.green : D.border}`, borderRadius: 8, color: D.text1, fontSize: 12, fontFamily: D.body, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'border-color .15s' }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <Route size={13} color={D.green} />
                        {routedHosp?.emergency_id === selected.id ? routedHosp.label : 'Select hospital...'}
                      </span>
                      <ChevronRight size={13} color={D.text2} style={{ transform: routeOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                    </button>

                    {/* Dropdown list */}
                    {routeOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999, marginTop: 4, background: D.bg1, border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 28px rgba(0,0,0,.55)' }}>
                        {HOSPITALS.map(h => (
                          <button key={h.id} onClick={() => routeToHospital(h)}
                            style={{ display: 'block', width: '100%', padding: '10px 13px', background: 'transparent', border: 'none', borderBottom: `1px solid ${D.border}`, color: D.text1, fontSize: 12, fontFamily: D.body, cursor: 'pointer', textAlign: 'left', transition: 'background .12s' }}
                            onMouseEnter={e => e.currentTarget.style.background = D.bg2}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{ fontWeight: 500, marginBottom: 2 }}>{h.label}</div>
                            <div style={{ fontSize: 10, color: D.text2, display: 'flex', gap: 10 }}>
                              <span>{h.dist}</span><span style={{ color: D.amber }}>~{h.eta} min ETA</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Confirmation pill */}
                  {routedHosp?.emergency_id === selected.id && (
                    <div style={{ marginTop: 7, background: 'rgba(63,185,80,.07)', border: `1px solid ${D.green}33`, borderRadius: 7, padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: '#4ade80' }}>
                      <CheckCircle size={12} color={D.green} />
                      Routed → {routedHosp.label} · ~{routedHosp.eta} min
                    </div>
                  )}
                </SideSection>

                {/* Assigned unit */}
                <SideSection title="Assigned Unit" icon={<Ambulance size={12} />}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: D.bg2, borderRadius: 7, border: `1px solid ${D.border}` }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: '#1e3a5f', border: '1px solid #2a4f7f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Ambulance size={14} color="#60a5fa" />
                    </div>
                    <div>
                      <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>UP-14 — ALS Unit</p>
                      <p style={{ margin: 0, fontSize: 11, color: responderPos ? D.green : D.text2 }}>
                        {responderPos ? '● En Route · Live GPS' : '~4 min ETA'}
                      </p>
                    </div>
                  </div>
                </SideSection>

                {/* Audit Trail */}
                <SideSection title="Audit Trail" icon={<Clock size={12} />} accent={D.blue}>
                  <p style={{ margin: '0 0 8px', fontSize: 10, color: D.text2 }}>Legal compliance log — SOS #{selected.id}</p>
                  {auditEvents.map((ev, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, animation: 'd-fadein .4s ease' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: D.bg0, border: `1.5px solid ${ev.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>{ev.icon}</div>
                        {idx < auditEvents.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 14, background: `${D.border}88`, margin: '2px 0' }} />}
                      </div>
                      <div style={{ paddingBottom: idx < auditEvents.length - 1 ? 9 : 0, paddingTop: 1 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#3a5278', display: 'block', marginBottom: 1 }}>[{fmtTs(ev.ts)}]</span>
                        <span style={{ fontSize: 11, color: ev.color, lineHeight: 1.4 }}>{ev.label}</span>
                      </div>
                    </div>
                  ))}
                  {auditEvents.length < 8 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 6 }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', background: D.bg3, border: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: D.text3, display: 'inline-block', animation: 'd-pulse 1.5s infinite' }} />
                      </div>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: D.text3 }}>Awaiting next event...</span>
                    </div>
                  )}
                </SideSection>

                {/* Resolve */}
                <button onClick={() => resolveEmergency(selected.id)} style={{ width: '100%', padding: '10px 0', background: '#0d1a0d', border: '1px solid #1a2d1a', borderRadius: 8, color: '#4ade80', fontFamily: D.font, fontWeight: 700, fontSize: 11, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <CheckCircle size={13} /> MARK RESOLVED
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────
function SideSection({ title, icon, accent = '#388bfd', children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ color: accent }}>{icon}</span>
        <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: 1.5, color: '#64748b', textTransform: 'uppercase' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function PlaceholderCard({ title, desc }) {
  return (
    <div style={{ background: '#0d1524', border: '1px dashed #1e3050', borderRadius: 12, padding: '20px 24px', marginBottom: 14, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div>
        <p style={{ margin: '0 0 5px', fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14 }}>{title}</p>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>{desc}</p>
      </div>
      <span style={{ fontSize: 9, fontFamily: "'Syne',sans-serif", color: '#64748b', background: '#111e33', border: '1px solid #1e3050', borderRadius: 5, padding: '3px 8px', flexShrink: 0, marginTop: 2 }}>SOON</span>
    </div>
  );
}
