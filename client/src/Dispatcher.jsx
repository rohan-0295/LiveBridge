import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import {
  MapPin, AlertTriangle, Shield, Navigation, Activity,
  CheckCircle, Radio, Clock, X, Heart, Syringe, Phone,
  User, Ambulance, Zap, Filter, RefreshCw, Eye, ChevronRight,
  Wifi, WifiOff, Bell, BarChart3, TrendingUp, Circle,
} from 'lucide-react';

// ── Fix Leaflet default icon URLs broken by Vite bundler ─────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Inject fonts + keyframes once ────────────────────────────────────────────
if (!document.getElementById('dp-assets')) {
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;700;800&family=DM+Sans:wght@300;400;500;600&display=swap';
  document.head.appendChild(link);

  const style = document.createElement('style');
  style.id = 'dp-assets';
  style.textContent = `
    @keyframes dp-pulse    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.15)} }
    @keyframes dp-ring     { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.2);opacity:0} }
    @keyframes dp-slidein  { from{opacity:0;transform:translateX(-12px)} to{opacity:1;transform:none} }
    @keyframes dp-fadein   { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
    @keyframes dp-spin     { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
    @keyframes dp-shimmer  { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
    @keyframes dp-blink    { 0%,100%{opacity:1} 50%{opacity:.3} }
    @keyframes dp-markmove { 0%{transform:translate(-50%,-100%) scale(1)} 50%{transform:translate(-50%,-100%) scale(1.15)} 100%{transform:translate(-50%,-100%) scale(1)} }

    .dp-sos-item         { transition: background .15s, border-color .15s, box-shadow .15s; }
    .dp-sos-item:hover   { background: #122852 !important; border-color: #1a3054 !important; }
    .dp-sos-item.active  { background: #0d2040 !important; border-color: #4da6ff !important; box-shadow: 0 0 0 1px #4da6ff22 inset; }
    .dp-nav-btn          { transition: all .15s; }
    .dp-nav-btn:hover    { background: #0d1f3c !important; color: #e8f0fe !important; }
    .dp-nav-btn.active   { background: #0d2040 !important; color: #4da6ff !important; border-color: #1a3054 !important; }
    .dp-action-btn       { transition: all .15s; }
    .dp-action-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .dp-resolve-btn:hover{ background: #0d2010 !important; border-color: #22c55e !important; color: #22c55e !important; }
    .dp-cancel-btn:hover { background: #2d0a08 !important; border-color: #f85149 !important; color: #f85149 !important; }
    .dp-card             { transition: border-color .2s; }
    .dp-card:hover       { border-color: #1a3054 !important; }
    .dp-skeleton         { background: linear-gradient(90deg, #0d1f3c 25%, #122852 50%, #0d1f3c 75%); background-size: 400px 100%; animation: dp-shimmer 1.4s infinite; border-radius: 6px; }

    .leaflet-container   { background: #040d1a !important; font-family: 'DM Sans', sans-serif !important; }
    .leaflet-popup-content-wrapper { background: #071428 !important; border: 1px solid #1a3054 !important; border-radius: 12px !important; box-shadow: 0 12px 40px rgba(0,0,0,.7) !important; color: #e8f0fe !important; }
    .leaflet-popup-tip   { background: #071428 !important; }
    .leaflet-popup-close-button { color: #6b8cba !important; font-size: 18px !important; }
    .leaflet-control-zoom a { background: #0d1f3c !important; color: #e8f0fe !important; border-color: #1a3054 !important; }
    .leaflet-control-zoom a:hover { background: #122852 !important; }
  `;
  document.head.appendChild(style);
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg0: '#040d1a', bg1: '#071428', bg2: '#0d1f3c', bg3: '#122852',
  border: '#1a3054', text1: '#e8f0fe', text2: '#6b8cba', text3: '#3a5278',
  blue: '#4da6ff', blueDim: '#0d2040', green: '#22c55e', greenDim: '#0d2010',
  red: '#f85149', redDim: '#2d0a08', amber: '#f59e0b', amberDim: '#2d1a00',
  purple: '#a78bfa', teal: '#2dd4bf',
  font: "'Syne', sans-serif", body: "'DM Sans', sans-serif",
};

// ── Severity utilities ────────────────────────────────────────────────────────
const SEV_COLOR = {
  Critical: T.red,
  High:     T.amber,
  Moderate: T.blue,
  Low:      T.green,
  Unknown:  T.text3,
};
const SEV_RANK  = { Critical: 0, High: 1, Moderate: 2, Low: 3, Unknown: 4 };
const sevColor  = (s) => SEV_COLOR[s] ?? T.text3;
const sevRank   = (s) => SEV_RANK[s] ?? 4;

// ── Custom map icon factories ─────────────────────────────────────────────────
function makeSOSIcon(severity, isSelected = false) {
  const color = sevColor(severity);
  const ring  = isSelected ? `<circle cx="18" cy="18" r="22" fill="none" stroke="${color}" stroke-width="1.5" opacity=".4" style="animation:dp-ring 1.5s ease-out infinite"/>` : '';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="50" viewBox="0 0 40 50">
      <defs>
        <filter id="s"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="${color}" flood-opacity="0.4"/></filter>
      </defs>
      ${ring}
      <ellipse cx="20" cy="46" rx="7" ry="3" fill="rgba(0,0,0,.35)"/>
      <path d="M20 1 C9 1 1 9 1 20 C1 33 20 50 20 50 C20 50 39 33 39 20 C39 9 31 1 20 1Z"
            fill="${color}" filter="url(#s)" opacity="${isSelected ? 1 : .9}"/>
      <path d="M20 5 C11 5 5 11 5 20 C5 31 20 46 20 46 C20 46 35 31 35 20 C35 11 29 5 20 5Z"
            fill="rgba(255,255,255,.1)"/>
      <circle cx="20" cy="20" r="11" fill="rgba(0,0,0,.25)"/>
      <text x="20" y="25" text-anchor="middle"
            font-family="'Syne',sans-serif" font-size="9" font-weight="800"
            fill="white" letter-spacing="1">SOS</text>
    </svg>`;
  return L.divIcon({
    html: svg, className: '',
    iconSize: [40, 50], iconAnchor: [20, 50], popupAnchor: [0, -52],
  });
}

function makeAmbIcon(unitId) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <rect x="1" y="1" width="34" height="34" rx="8" fill="#0d2040" stroke="#4da6ff" stroke-width="1.5"/>
      <rect x="8" y="14" width="20" height="10" rx="2" fill="#4da6ff" opacity=".9"/>
      <rect x="6" y="18" width="5" height="6" rx="1" fill="#4da6ff" opacity=".7"/>
      <rect x="25" y="18" width="5" height="6" rx="1" fill="#4da6ff" opacity=".7"/>
      <rect x="16" y="10" width="4" height="4" rx="1" fill="#4da6ff" opacity=".6"/>
      <circle cx="11" cy="26" r="3" fill="#071428" stroke="#4da6ff" stroke-width="1.5"/>
      <circle cx="25" cy="26" r="3" fill="#071428" stroke="#4da6ff" stroke-width="1.5"/>
      <text x="18" y="22" text-anchor="middle" font-family="'Syne',sans-serif" font-size="7" font-weight="800" fill="white">${unitId}</text>
    </svg>`;
  return L.divIcon({
    html: svg, className: '',
    iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
  });
}

// ── MapAutoPan: smoothly fly to selected emergency ────────────────────────────
function MapAutoPan({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target?.latitude && target?.longitude) {
      map.flyTo([parseFloat(target.latitude), parseFloat(target.longitude)], 15, { duration: 1.2, easeLinearity: 0.4 });
    }
  }, [target, map]);
  return null;
}

// ── LiveMarker: animates smoothly when coords update ─────────────────────────
function LiveMarker({ id, position, icon, children }) {
  const markerRef = useRef(null);
  useEffect(() => {
    if (markerRef.current && position) {
      markerRef.current.setLatLng(position);
    }
  }, [position]);
  if (!position) return null;
  return (
    <Marker ref={markerRef} position={position} icon={icon}>
      {children}
    </Marker>
  );
}

// ── Socket singleton ──────────────────────────────────────────────────────────
let _dispSocket = null;
function getDispSocket() {
  if (!_dispSocket) _dispSocket = io('http://localhost:8000', { autoConnect: true });
  return _dispSocket;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN DISPATCHER COMPONENT
// ════════════════════════════════════════════════════════════════════════════════
export default function Dispatcher() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [emergencies,   setEmergencies]   = useState([]);
  const [selected,      setSelected]      = useState(null);   // emergency object
  const [connected,     setConnected]     = useState(false);
  const [victimCoords,  setVictimCoords]  = useState({});     // { [emergencyId]: {lat,lng} }
  const [responderCoords, setResponderCoords] = useState({}); // { [emergencyId]: {lat,lng} }
  const [ambulances,    setAmbulances]    = useState([
    { id: 'UP-14', lat: 12.8450, lng: 80.0280, status: 'En Route' },
    { id: 'UP-07', lat: 12.8620, lng: 80.0550, status: 'Available' },
    { id: 'UP-22', lat: 12.8200, lng: 80.0700, status: 'Available' },
  ]);
  const [vault,         setVault]         = useState(null);
  const [vaultLoading,  setVaultLoading]  = useState(false);
  const [panTarget,     setPanTarget]     = useState(null);
  const [activeNav,     setActiveNav]     = useState('map');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [resolving,     setResolving]     = useState(false);
  const [notification,  setNotification]  = useState(null); // { msg, type }
  const socketRef = useRef(null);

  // ── Notification helper ────────────────────────────────────────────────────
  const notify = useCallback((msg, type = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  }, []);

  // ── Socket.io setup ────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getDispSocket();
    socketRef.current = socket;

    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    // New SOS arrives
    const onNewEmergency = (emergency) => {
      setEmergencies(prev => {
        if (prev.find(e => e.id === emergency.id)) return prev;
        return [emergency, ...prev];
      });
      // Auto-select if nothing selected
      setSelected(prev => prev ?? emergency);
      setPanTarget(emergency);
      notify(`🚨 New SOS #${emergency.id} — ${emergency.severity_score ?? 'Unknown'}`, 'critical');
    };

    // Emergency resolved → remove from list
    const onResolved = ({ id }) => {
      setEmergencies(prev => prev.filter(e => e.id !== id));
      setSelected(prev => (prev?.id === id ? null : prev));
      notify(`✓ Emergency #${id} resolved`, 'success');
    };

    // Victim GPS update → move their marker live
    const onVictimLocation = ({ emergency_id, latitude, longitude }) => {
      setVictimCoords(prev => ({
        ...prev,
        [emergency_id]: { lat: parseFloat(latitude), lng: parseFloat(longitude) },
      }));
    };

    // Responder GPS update → move ambulance marker
    const onResponderLocation = ({ emergency_id, latitude, longitude, unit_id }) => {
      setResponderCoords(prev => ({
        ...prev,
        [emergency_id]: { lat: parseFloat(latitude), lng: parseFloat(longitude) },
      }));
      if (unit_id) {
        setAmbulances(prev => prev.map(a =>
          a.id === unit_id ? { ...a, lat: parseFloat(latitude), lng: parseFloat(longitude), status: 'En Route' } : a
        ));
      }
    };

    // Status update
    const onStatusUpdate = ({ emergency_id, status }) => {
      setEmergencies(prev => prev.map(e => e.id === emergency_id ? { ...e, status } : e));
      if (selected?.id === emergency_id) {
        setSelected(prev => prev ? { ...prev, status } : prev);
      }
    };

    socket.on('connect',                  onConnect);
    socket.on('disconnect',               onDisconnect);
    socket.on('new_emergency',            onNewEmergency);
    socket.on('emergency_resolved',       onResolved);
    socket.on('victim_location_update',   onVictimLocation);
    socket.on('responder_location_update', onResponderLocation);
    socket.on('status_update',            onStatusUpdate);

    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect',                  onConnect);
      socket.off('disconnect',               onDisconnect);
      socket.off('new_emergency',            onNewEmergency);
      socket.off('emergency_resolved',       onResolved);
      socket.off('victim_location_update',   onVictimLocation);
      socket.off('responder_location_update', onResponderLocation);
      socket.off('status_update',            onStatusUpdate);
    };
  }, [notify, selected]);

  // ── Initial fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('http://localhost:8000/api/emergencies')
      .then(r => r.json())
      .then(data => {
        setEmergencies(data);
        if (data.length > 0) {
          const first = [...data].sort((a,b) => sevRank(a.severity_score) - sevRank(b.severity_score))[0];
          setSelected(first);
          setPanTarget(first);
        }
      })
      .catch(err => console.error('Fetch emergencies:', err));
  }, []);

  // ── Fetch vault when selection changes ────────────────────────────────────
  useEffect(() => {
    if (!selected?.user_id) { setVault(null); return; }
    setVaultLoading(true);
    setVault(null);
    fetch(`http://localhost:8000/api/vault/${selected.user_id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setVault(data); setVaultLoading(false); })
      .catch(() => { setVault(null); setVaultLoading(false); });
  }, [selected?.id, selected?.user_id]);

  // ── Select emergency (+ pan map) ──────────────────────────────────────────
  const selectEmergency = useCallback((emergency) => {
    setSelected(emergency);
    setPanTarget(emergency);
    setActiveNav('map');
  }, []);

  // ── Resolve emergency ─────────────────────────────────────────────────────
  const resolveEmergency = useCallback(async (id) => {
    setResolving(true);
    try {
      await fetch(`http://localhost:8000/api/emergencies/${id}/resolve`, { method: 'PATCH' });
      // Socket event handles state update
    } catch (err) {
      console.error('Resolve error:', err);
      // Optimistically remove anyway
      setEmergencies(prev => prev.filter(e => e.id !== id));
      setSelected(prev => prev?.id === id ? null : prev);
    } finally {
      setResolving(false);
    }
  }, []);

  // ── Dispatch ambulance ────────────────────────────────────────────────────
  const dispatchAmbulance = useCallback(async (emergencyId, unitId) => {
    try {
      await fetch('http://localhost:8000/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emergency_id: emergencyId, unit_id: unitId }),
      });
      setAmbulances(prev => prev.map(a => a.id === unitId ? { ...a, status: 'En Route' } : a));
      notify(`🚑 ${unitId} dispatched to SOS #${emergencyId}`, 'success');
    } catch (err) {
      console.error('Dispatch error:', err);
    }
  }, [notify]);

  // ── Filtered + sorted SOS list ────────────────────────────────────────────
  const filteredEmergencies = useMemo(() => {
    let list = [...emergencies];
    if (severityFilter !== 'All') list = list.filter(e => e.severity_score === severityFilter);
    return list.sort((a, b) => sevRank(a.severity_score) - sevRank(b.severity_score));
  }, [emergencies, severityFilter]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:    emergencies.length,
    critical: emergencies.filter(e => e.severity_score === 'Critical').length,
    high:     emergencies.filter(e => e.severity_score === 'High').length,
    avail:    ambulances.filter(a => a.status === 'Available').length,
  }), [emergencies, ambulances]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', height: '100vh', width: '100vw',
      background: T.bg0, color: T.text1,
      fontFamily: T.body, overflow: 'hidden',
    }}>

      {/* ════════════ LEFT SIDEBAR — SOS INTAKE QUEUE ════════════ */}
      <LeftSidebar
        emergencies={filteredEmergencies}
        allCount={emergencies.length}
        selected={selected}
        connected={connected}
        stats={stats}
        severityFilter={severityFilter}
        setSeverityFilter={setSeverityFilter}
        onSelect={selectEmergency}
        onResolve={resolveEmergency}
        resolving={resolving}
      />

      {/* ════════════ CENTER — COMMAND MAP ════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0 }}>

        {/* Top bar */}
        <TopBar
          connected={connected}
          stats={stats}
          activeNav={activeNav}
          setActiveNav={setActiveNav}
          selected={selected}
        />

        {/* Map */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <CommandMap
            emergencies={emergencies}
            ambulances={ambulances}
            selected={selected}
            panTarget={panTarget}
            victimCoords={victimCoords}
            responderCoords={responderCoords}
            onSelectEmergency={selectEmergency}
            onResolve={resolveEmergency}
            onDispatch={dispatchAmbulance}
          />
        </div>
      </div>

      {/* ════════════ RIGHT SIDEBAR — MISSION DETAILS ════════════ */}
      <RightSidebar
        selected={selected}
        vault={vault}
        vaultLoading={vaultLoading}
        onResolve={resolveEmergency}
        onDispatch={dispatchAmbulance}
        ambulances={ambulances}
        resolving={resolving}
        victimCoords={victimCoords}
      />

      {/* ── Toast notification ── */}
      {notification && (
        <Toast msg={notification.msg} type={notification.type} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// LEFT SIDEBAR
// ════════════════════════════════════════════════════════════════════════════════
function LeftSidebar({ emergencies, allCount, selected, connected, stats, severityFilter, setSeverityFilter, onSelect, onResolve, resolving }) {
  const FILTERS = ['All', 'Critical', 'High', 'Moderate', 'Low'];

  return (
    <div style={{
      width: 280, display: 'flex', flexDirection: 'column',
      background: T.bg1, borderRight: `1px solid ${T.border}`,
      flexShrink: 0, zIndex: 10,
    }}>

      {/* Logo */}
      <div style={{
        padding: '18px 20px 14px',
        borderBottom: `1px solid ${T.border}`,
        background: `linear-gradient(180deg, ${T.bg2}88, transparent)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: T.blueDim, border: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 0 12px ${T.blue}22`,
          }}>
            <Activity size={18} color={T.blue} />
          </div>
          <div>
            <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 13, letterSpacing: '2px', color: T.text1 }}>LIVEBRIDGE</div>
            <div style={{ fontSize: 10, color: T.text3, letterSpacing: '1px' }}>DISPATCH CENTER</div>
          </div>
          {/* Live indicator */}
          <div style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
            background: connected ? T.greenDim : T.redDim,
            border: `1px solid ${connected ? T.green+'44' : T.red+'44'}`,
            borderRadius: 20, padding: '3px 8px',
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: connected ? T.green : T.red,
              display: 'inline-block',
              animation: connected ? 'dp-pulse 1.8s infinite' : 'dp-blink 1s infinite',
            }} />
            <span style={{ fontSize: 9, color: connected ? T.green : T.red, fontFamily: T.font, letterSpacing: '1px' }}>
              {connected ? 'LIVE' : 'DISC'}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
          {[
            { label: 'SOS', value: allCount, color: T.text1 },
            { label: 'CRIT', value: stats.critical, color: T.red },
            { label: 'HIGH', value: stats.high, color: T.amber },
            { label: 'AVAIL', value: stats.avail, color: T.green },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: T.bg2, border: `1px solid ${T.border}`,
              borderRadius: 8, padding: '7px 4px', textAlign: 'center',
            }}>
              <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 16, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 9, color: T.text3, marginTop: 2, letterSpacing: '0.5px' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ padding: '10px 12px 8px', borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setSeverityFilter(f)}
            style={{
              padding: '3px 9px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
              fontFamily: T.font, fontWeight: 700, letterSpacing: '0.5px',
              background: severityFilter === f ? (f === 'All' ? T.blue : sevColor(f)) + '22' : 'transparent',
              color: severityFilter === f ? (f === 'All' ? T.blue : sevColor(f)) : T.text3,
              border: `1px solid ${severityFilter === f ? (f === 'All' ? T.blue : sevColor(f)) + '55' : T.border}`,
              transition: 'all .15s',
            }}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {/* SOS list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {emergencies.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ marginBottom: 10 }}><CheckCircle size={28} color={T.green} /></div>
            <div style={{ fontFamily: T.font, fontWeight: 700, fontSize: 13, color: T.text2, marginBottom: 4 }}>All Clear</div>
            <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.6 }}>No active emergencies.<br />Monitoring for incoming SOS.</div>
          </div>
        ) : (
          emergencies.map(e => (
            <SOSCard
              key={e.id}
              emergency={e}
              isSelected={selected?.id === e.id}
              onSelect={() => onSelect(e)}
              onResolve={() => onResolve(e.id)}
              resolving={resolving}
            />
          ))
        )}
      </div>

      {/* Dispatcher footer */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: T.bg3, border: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: T.font, fontWeight: 800, fontSize: 11, color: T.blue,
        }}>
          RS
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text1 }}>Rohan Shaw</div>
          <div style={{ fontSize: 10, color: T.green }}>● On Duty</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 10, color: T.text3 }}>
          <Clock size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

// ── SOS intake card ───────────────────────────────────────────────────────────
function SOSCard({ emergency: e, isSelected, onSelect, onResolve, resolving }) {
  const color   = sevColor(e.severity_score);
  const isCrit  = e.severity_score === 'Critical';
  const elapsed = useMemo(() => {
    const diff = Math.floor((Date.now() - new Date(e.created_at).getTime()) / 1000);
    if (diff < 60)  return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    return `${Math.floor(diff/3600)}h ago`;
  }, [e.created_at]);

  return (
    <div
      className={`dp-sos-item ${isSelected ? 'active' : ''}`}
      onClick={onSelect}
      style={{
        background: isSelected ? T.blueDim : `${color}08`,
        border: `1px solid ${isSelected ? T.blue : color + '33'}`,
        borderRadius: 12, padding: '10px 12px', marginBottom: 7,
        cursor: 'pointer', position: 'relative', overflow: 'hidden',
        animation: isCrit && !isSelected ? 'dp-slidein .3s ease' : 'dp-slidein .3s ease',
      }}
    >
      {/* Critical pulse glow */}
      {isCrit && (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          background: `${T.red}06`,
          animation: 'dp-blink 2s infinite',
          pointerEvents: 'none', borderRadius: 11,
        }} />
      )}

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {/* Severity dot */}
          <div style={{ position: 'relative' }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: color,
              animation: isCrit ? 'dp-pulse 1.2s ease-in-out infinite' : 'none',
            }} />
            {isCrit && (
              <div style={{
                position: 'absolute', top: -4, left: -4,
                width: 16, height: 16, borderRadius: '50%',
                border: `1px solid ${color}`,
                animation: 'dp-ring 1.5s ease-out infinite',
              }} />
            )}
          </div>
          <span style={{ fontFamily: T.font, fontWeight: 800, fontSize: 12, color: T.text1 }}>
            SOS #{e.id}
          </span>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.8px',
          color, background: `${color}18`,
          border: `1px solid ${color}33`,
          borderRadius: 4, padding: '2px 6px',
          fontFamily: T.font,
        }}>
          {(e.severity_score || 'UNKNOWN').toUpperCase()}
        </span>
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: T.text3 }}>
          <Clock size={9} /> {elapsed}
        </span>
        <span style={{
          fontSize: 10, color: T.text3,
          background: T.bg3, borderRadius: 4, padding: '1px 6px',
        }}>
          {e.status || 'Pending'}
        </span>
        {e.latitude && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: T.text3 }}>
            <MapPin size={9} />
            {parseFloat(e.latitude).toFixed(3)}, {parseFloat(e.longitude).toFixed(3)}
          </span>
        )}
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={(ev) => { ev.stopPropagation(); onSelect(); }}
          style={{
            flex: 1, padding: '5px 0', fontSize: 10, cursor: 'pointer',
            background: isSelected ? `${T.blue}22` : T.bg2,
            color: isSelected ? T.blue : T.text3,
            border: `1px solid ${isSelected ? T.blue + '44' : T.border}`,
            borderRadius: 7, fontFamily: T.font, fontWeight: 700, letterSpacing: '0.5px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}
        >
          <Eye size={10} /> VIEW
        </button>
        <button
          onClick={(ev) => { ev.stopPropagation(); onResolve(); }}
          disabled={resolving}
          className="dp-resolve-btn"
          style={{
            flex: 1, padding: '5px 0', fontSize: 10, cursor: 'pointer',
            background: 'transparent', color: T.text3,
            border: `1px solid ${T.border}`,
            borderRadius: 7, fontFamily: T.font, fontWeight: 700, letterSpacing: '0.5px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            opacity: resolving ? .5 : 1,
          }}
        >
          <CheckCircle size={10} /> RESOLVE
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// TOP BAR
// ════════════════════════════════════════════════════════════════════════════════
function TopBar({ connected, stats, activeNav, setActiveNav, selected }) {
  const NAV = [
    { id: 'map',  label: 'Live Map',   icon: MapPin },
    { id: 'stats', label: 'Analytics', icon: BarChart3 },
  ];

  return (
    <div style={{
      height: 56, background: T.bg1,
      borderBottom: `1px solid ${T.border}`,
      display: 'flex', alignItems: 'center',
      padding: '0 20px', justifyContent: 'space-between',
      flexShrink: 0, zIndex: 100,
    }}>
      {/* Nav tabs */}
      <div style={{ display: 'flex', gap: 4 }}>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveNav(id)}
            className={`dp-nav-btn ${activeNav === id ? 'active' : ''}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
              background: activeNav === id ? T.blueDim : 'transparent',
              color: activeNav === id ? T.blue : T.text2,
              border: `1px solid ${activeNav === id ? T.border : 'transparent'}`,
              fontFamily: T.font, fontWeight: 700, fontSize: 11, letterSpacing: '0.8px',
            }}
          >
            <Icon size={13} /> {label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Center — selected emergency breadcrumb */}
      {selected && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: T.bg2, border: `1px solid ${T.border}`,
          borderRadius: 8, padding: '5px 12px',
          animation: 'dp-fadein .2s ease',
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: sevColor(selected.severity_score) }} />
          <span style={{ fontFamily: T.font, fontWeight: 700, fontSize: 11, color: T.text1 }}>
            SOS #{selected.id}
          </span>
          <ChevronRight size={11} color={T.text3} />
          <span style={{ fontSize: 11, color: T.text2 }}>{selected.status || 'Pending'}</span>
          <span style={{ fontSize: 10, color: sevColor(selected.severity_score), fontFamily: T.font, fontWeight: 700 }}>
            {selected.severity_score}
          </span>
        </div>
      )}

      {/* Right — status chips */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {stats.critical > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: T.redDim, border: `1px solid ${T.red}33`,
            borderRadius: 8, padding: '4px 10px',
            animation: 'dp-blink 2s infinite',
          }}>
            <AlertTriangle size={12} color={T.red} />
            <span style={{ fontSize: 11, color: T.red, fontWeight: 600 }}>{stats.critical} Critical</span>
          </div>
        )}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: connected ? T.greenDim : T.redDim,
          border: `1px solid ${connected ? T.green + '33' : T.red + '33'}`,
          borderRadius: 8, padding: '4px 10px',
        }}>
          {connected ? <Wifi size={12} color={T.green} /> : <WifiOff size={12} color={T.red} />}
          <span style={{ fontSize: 11, color: connected ? T.green : T.red, fontWeight: 600 }}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// COMMAND MAP
// ════════════════════════════════════════════════════════════════════════════════
function CommandMap({ emergencies, ambulances, selected, panTarget, victimCoords, responderCoords, onSelectEmergency, onResolve, onDispatch }) {
  return (
    <MapContainer
      center={[13.0827, 80.2707]}
      zoom={12}
      style={{ height: '100%', width: '100%', zIndex: 0 }}
      zoomControl={true}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap contributors &copy; CARTO'
      />

      {/* Auto-pan to selected */}
      <MapAutoPan target={panTarget} />

      {/* SOS markers */}
      {emergencies.map(e => {
        const isSelected = selected?.id === e.id;
        // Use live victim coords if available, otherwise fallback to stored coords
        const livePos = victimCoords[e.id];
        const lat = livePos ? livePos.lat : parseFloat(e.latitude);
        const lng = livePos ? livePos.lng : parseFloat(e.longitude);
        if (isNaN(lat) || isNaN(lng)) return null;

        return (
          <LiveMarker
            key={`sos-${e.id}`}
            id={`sos-${e.id}`}
            position={[lat, lng]}
            icon={makeSOSIcon(e.severity_score, isSelected)}
          >
            <Popup>
              <MapPopup
                emergency={e}
                onSelect={() => onSelectEmergency(e)}
                onResolve={() => onResolve(e.id)}
                onDispatch={onDispatch}
              />
            </Popup>
          </LiveMarker>
        );
      })}

      {/* Ambulance markers */}
      {ambulances.map(amb => (
        <LiveMarker
          key={`amb-${amb.id}`}
          id={`amb-${amb.id}`}
          position={[amb.lat, amb.lng]}
          icon={makeAmbIcon(amb.id)}
        >
          <Popup>
            <div style={{ fontFamily: T.body, minWidth: 160 }}>
              <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 13, color: T.blue, marginBottom: 4 }}>
                Ambulance {amb.id}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.text2 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: amb.status === 'Available' ? T.green : T.amber }} />
                {amb.status}
              </div>
            </div>
          </Popup>
        </LiveMarker>
      ))}
    </MapContainer>
  );
}

// ── Map popup ─────────────────────────────────────────────────────────────────
function MapPopup({ emergency: e, onSelect, onResolve, onDispatch }) {
  const color = sevColor(e.severity_score);
  return (
    <div style={{ fontFamily: T.body, minWidth: 200, padding: '2px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontFamily: T.font, fontWeight: 800, fontSize: 14, color: T.text1 }}>SOS #{e.id}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, color,
          background: `${color}22`, border: `1px solid ${color}44`,
          borderRadius: 4, padding: '2px 7px', fontFamily: T.font, letterSpacing: '1px',
        }}>
          {(e.severity_score || 'UNKNOWN').toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: 11, color: T.text2, marginBottom: 4 }}>
        Status: <span style={{ color: T.text1, fontWeight: 600 }}>{e.status || 'Pending'}</span>
      </div>
      <div style={{ fontSize: 11, color: T.text2, marginBottom: 4 }}>
        Time: {new Date(e.created_at).toLocaleTimeString()}
      </div>
      <div style={{ fontSize: 10, color: T.text3, marginBottom: 10 }}>
        {parseFloat(e.latitude).toFixed(5)}, {parseFloat(e.longitude).toFixed(5)}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onSelect} style={{
          flex: 1, padding: '6px 0', background: T.blueDim, color: T.blue,
          border: `1px solid ${T.blue}33`, borderRadius: 7, fontSize: 11,
          cursor: 'pointer', fontFamily: T.font, fontWeight: 700,
        }}>
          DETAILS
        </button>
        <button onClick={onResolve} style={{
          flex: 1, padding: '6px 0', background: T.greenDim, color: T.green,
          border: `1px solid ${T.green}33`, borderRadius: 7, fontSize: 11,
          cursor: 'pointer', fontFamily: T.font, fontWeight: 700,
        }}>
          RESOLVE
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// RIGHT SIDEBAR — MISSION DETAILS & MEDICAL VAULT
// ════════════════════════════════════════════════════════════════════════════════
function RightSidebar({ selected, vault, vaultLoading, onResolve, onDispatch, ambulances, resolving, victimCoords }) {
  const [dispatchOpen, setDispatchOpen] = useState(false);

  if (!selected) {
    return (
      <div style={{
        width: 300, background: T.bg1, borderLeft: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12, flexShrink: 0,
      }}>
        <Shield size={32} color={T.text3} />
        <div style={{ fontFamily: T.font, fontWeight: 700, fontSize: 13, color: T.text3, textAlign: 'center', lineHeight: 1.6 }}>
          Select an SOS<br />to view mission details
        </div>
      </div>
    );
  }

  const color        = sevColor(selected.severity_score);
  const liveCoords   = victimCoords[selected.id];
  const availAmbs    = ambulances.filter(a => a.status === 'Available');

  const STATUS_STEPS = ['Pending', 'Dispatched', 'En Route', 'On Scene', 'Resolved'];
  const currentStep  = STATUS_STEPS.indexOf(selected.status) ?? 0;

  return (
    <div style={{
      width: 300, background: T.bg1, borderLeft: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto',
    }}>

      {/* ── Header ── */}
      <div style={{
        padding: '16px 18px 14px',
        background: `linear-gradient(135deg, ${color}12, ${T.bg2}88)`,
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}>
        {/* Emergency title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: color,
              animation: selected.severity_score === 'Critical' ? 'dp-pulse 1.2s infinite' : 'none',
            }} />
            <span style={{ fontFamily: T.font, fontWeight: 800, fontSize: 16, color: T.text1 }}>SOS #{selected.id}</span>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, color,
            background: `${color}18`, border: `1px solid ${color}44`,
            borderRadius: 5, padding: '3px 8px', fontFamily: T.font, letterSpacing: '0.8px',
          }}>
            {(selected.severity_score || 'UNKNOWN').toUpperCase()}
          </span>
        </div>

        {/* Time + coords */}
        <div style={{ display: 'flex', gap: 10, fontSize: 10, color: T.text3 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Clock size={9} /> {new Date(selected.created_at).toLocaleTimeString()}
          </span>
          {selected.latitude && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <MapPin size={9} />
              {parseFloat(selected.latitude).toFixed(4)}, {parseFloat(selected.longitude).toFixed(4)}
            </span>
          )}
        </div>

        {/* Live location pill */}
        {liveCoords && (
          <div style={{
            marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5,
            background: T.greenDim, border: `1px solid ${T.green}33`,
            borderRadius: 6, padding: '3px 8px',
          }}>
            <Navigation size={9} color={T.green} style={{ animation: 'dp-pulse 1.5s infinite' }} />
            <span style={{ fontSize: 10, color: T.green, fontFamily: T.font, fontWeight: 700, letterSpacing: '0.5px' }}>
              LIVE GPS ACTIVE
            </span>
            <span style={{ fontSize: 9, color: T.text3 }}>
              {liveCoords.lat.toFixed(4)}, {liveCoords.lng.toFixed(4)}
            </span>
          </div>
        )}
      </div>

      {/* ── Mission Status Timeline ── */}
      <Section title="Mission Status" icon={<Activity size={12} />}>
        <div style={{ position: 'relative', paddingLeft: 20 }}>
          {/* Track line */}
          <div style={{
            position: 'absolute', left: 7, top: 8, bottom: 8,
            width: 1, background: T.border,
          }} />
          {STATUS_STEPS.map((step, i) => {
            const done    = i <= currentStep;
            const current = i === currentStep;
            return (
              <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, position: 'relative' }}>
                <div style={{
                  width: 14, height: 14, borderRadius: '50%',
                  background: done ? (current ? color : T.green) : T.bg3,
                  border: `2px solid ${done ? (current ? color : T.green) : T.border}`,
                  flexShrink: 0, zIndex: 1,
                  boxShadow: current ? `0 0 8px ${color}66` : 'none',
                  animation: current ? 'dp-pulse 1.5s infinite' : 'none',
                }} />
                <span style={{
                  fontSize: 11, fontWeight: current ? 600 : 400,
                  color: done ? (current ? color : T.text1) : T.text3,
                }}>
                  {step}
                </span>
                {current && (
                  <span style={{
                    marginLeft: 'auto', fontSize: 9, color,
                    background: `${color}18`, borderRadius: 4, padding: '1px 6px',
                    fontFamily: T.font, fontWeight: 700, letterSpacing: '0.5px',
                  }}>
                    NOW
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Dispatch Controls ── */}
      <Section title="Dispatch Controls" icon={<Zap size={12} />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {/* Dispatch ambulance */}
          <button
            onClick={() => setDispatchOpen(p => !p)}
            className="dp-action-btn"
            style={{
              width: '100%', padding: '9px 14px',
              background: T.blueDim, border: `1px solid ${T.blue}44`,
              borderRadius: 9, color: T.blue,
              fontFamily: T.font, fontWeight: 700, fontSize: 11, letterSpacing: '0.8px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              cursor: 'pointer',
            }}
          >
            <Ambulance size={13} /> DISPATCH AMBULANCE
          </button>

          {/* Unit picker */}
          {dispatchOpen && (
            <div style={{
              background: T.bg2, border: `1px solid ${T.border}`,
              borderRadius: 9, padding: 10, animation: 'dp-fadein .2s ease',
            }}>
              <div style={{ fontSize: 10, color: T.text3, marginBottom: 7, fontFamily: T.font, letterSpacing: '0.8px' }}>
                SELECT UNIT
              </div>
              {availAmbs.length === 0 ? (
                <div style={{ fontSize: 11, color: T.text3, textAlign: 'center', padding: '8px 0' }}>
                  No available units
                </div>
              ) : availAmbs.map(amb => (
                <button
                  key={amb.id}
                  onClick={() => { onDispatch(selected.id, amb.id); setDispatchOpen(false); }}
                  className="dp-action-btn"
                  style={{
                    width: '100%', padding: '7px 10px', marginBottom: 5,
                    background: T.bg3, border: `1px solid ${T.border}`,
                    borderRadius: 7, color: T.text1, fontSize: 11,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    fontFamily: T.body, textAlign: 'left',
                  }}
                >
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.green, flexShrink: 0 }} />
                  <span style={{ fontFamily: T.font, fontWeight: 700 }}>{amb.id}</span>
                  <span style={{ fontSize: 10, color: T.text3 }}>Available</span>
                </button>
              ))}
            </div>
          )}

          {/* Resolve */}
          <button
            onClick={() => onResolve(selected.id)}
            disabled={resolving}
            className="dp-cancel-btn dp-action-btn"
            style={{
              width: '100%', padding: '9px 14px',
              background: 'transparent', border: `1px solid ${T.border}`,
              borderRadius: 9, color: T.text3,
              fontFamily: T.font, fontWeight: 700, fontSize: 11, letterSpacing: '0.8px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              cursor: 'pointer', opacity: resolving ? .5 : 1,
            }}
          >
            <X size={13} /> CANCEL / RESOLVE SOS
          </button>
        </div>
      </Section>

      {/* ── Medical Vault ── */}
      <Section title="Medical Vault" icon={<Heart size={12} />} accent={T.red}>
        {vaultLoading ? (
          <VaultSkeleton />
        ) : vault ? (
          <VaultDisplay vault={vault} />
        ) : (
          <div style={{ fontSize: 11, color: T.text3, textAlign: 'center', padding: '12px 0' }}>
            No medical data on file
          </div>
        )}
      </Section>

      {/* ── Emergency contacts ── */}
      {!vaultLoading && vault?.contacts?.length > 0 && (
        <Section title="Emergency Contacts" icon={<Phone size={12} />} accent={T.green}>
          {vault.contacts.map((c, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '7px 0', borderBottom: i < vault.contacts.length - 1 ? `1px solid ${T.border}` : 'none',
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text1 }}>{c.name}</div>
                <div style={{ fontSize: 10, color: T.text3 }}>{c.rel}</div>
              </div>
              <a href={`tel:${c.phone}`} style={{
                fontSize: 11, color: T.green, textDecoration: 'none',
                background: T.greenDim, border: `1px solid ${T.green}33`,
                borderRadius: 6, padding: '3px 8px',
                fontFamily: T.font, fontWeight: 700, letterSpacing: '0.5px',
              }}>
                CALL
              </a>
            </div>
          ))}
        </Section>
      )}

      <div style={{ height: 20, flexShrink: 0 }} />
    </div>
  );
}

// ── Vault display ─────────────────────────────────────────────────────────────
function VaultDisplay({ vault: v }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Blood type */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{
          background: `${T.red}12`, border: `1px solid ${T.red}33`,
          borderRadius: 9, padding: '10px 12px', textAlign: 'center', flex: 1,
        }}>
          <div style={{ fontSize: 9, color: T.text3, letterSpacing: '1px', marginBottom: 4, fontFamily: T.font }}>BLOOD TYPE</div>
          <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 22, color: T.red }}>{v.bloodType || '—'}</div>
        </div>
        <div style={{
          background: T.bg2, border: `1px solid ${T.border}`,
          borderRadius: 9, padding: '10px 12px', flex: 2,
        }}>
          <div style={{ fontSize: 9, color: T.text3, letterSpacing: '1px', marginBottom: 4, fontFamily: T.font }}>DOCTOR</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.text1, lineHeight: 1.4 }}>{v.doctorName || '—'}</div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{v.hospital || ''}</div>
        </div>
      </div>

      {/* Allergies */}
      {v.allergies?.length > 0 && (
        <VaultRow label="ALLERGIES" color={T.red}>
          {v.allergies.map((a, i) => (
            <span key={i} style={{
              fontSize: 10, fontWeight: 500, color: T.red,
              background: `${T.red}14`, borderRadius: 5, padding: '2px 7px',
            }}>{a}</span>
          ))}
        </VaultRow>
      )}

      {/* Conditions */}
      {v.conditions?.length > 0 && (
        <VaultRow label="CONDITIONS" color={T.amber}>
          {v.conditions.map((c, i) => (
            <span key={i} style={{
              fontSize: 10, fontWeight: 500, color: T.amber,
              background: `${T.amber}14`, borderRadius: 5, padding: '2px 7px',
            }}>{c}</span>
          ))}
        </VaultRow>
      )}

      {/* Medications */}
      {v.medications?.length > 0 && (
        <VaultRow label="MEDICATIONS" color={T.blue}>
          {v.medications.map((m, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '4px 0', borderBottom: i < v.medications.length - 1 ? `1px solid ${T.border}` : 'none',
              width: '100%',
            }}>
              <span style={{ fontSize: 11, color: T.text1, fontWeight: 500 }}>{m.name}</span>
              <span style={{ fontSize: 10, color: T.blue, background: `${T.blue}18`, borderRadius: 5, padding: '1px 6px' }}>{m.dose}</span>
            </div>
          ))}
        </VaultRow>
      )}
    </div>
  );
}

function VaultRow({ label, color, children }) {
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 9, padding: '9px 11px' }}>
      <div style={{ fontSize: 9, color, letterSpacing: '1px', marginBottom: 6, fontFamily: T.font, fontWeight: 700 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{children}</div>
    </div>
  );
}

// ── Loading skeleton for vault ────────────────────────────────────────────────
function VaultSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="dp-skeleton" style={{ height: 60, flex: 1 }} />
        <div className="dp-skeleton" style={{ height: 60, flex: 2 }} />
      </div>
      {[48, 38, 60].map((h, i) => (
        <div key={i} className="dp-skeleton" style={{ height: h }} />
      ))}
    </div>
  );
}

// ── Reusable section wrapper ──────────────────────────────────────────────────
function Section({ title, icon, accent = T.blue, children }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 11 }}>
        <span style={{ color: accent }}>{icon}</span>
        <span style={{ fontSize: 9, fontFamily: T.font, fontWeight: 700, letterSpacing: '1.2px', color: T.text3, textTransform: 'uppercase' }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

// ── Toast notification ────────────────────────────────────────────────────────
function Toast({ msg, type }) {
  const bgMap  = { critical: T.redDim, success: T.greenDim, info: T.blueDim };
  const colMap = { critical: T.red, success: T.green, info: T.blue };
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 99999, animation: 'dp-fadein .25s ease',
      background: bgMap[type] ?? T.bg2,
      border: `1px solid ${(colMap[type] ?? T.blue) + '55'}`,
      borderRadius: 12, padding: '10px 18px',
      display: 'flex', alignItems: 'center', gap: 8,
      boxShadow: `0 8px 32px rgba(0,0,0,.6)`,
      maxWidth: 360,
    }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: colMap[type] ?? T.blue, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: T.text1, fontFamily: T.body }}>{msg}</span>
    </div>
  );
}
