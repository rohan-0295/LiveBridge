import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import {
  Navigation, CheckCircle, XCircle, AlertTriangle, Clock,
  Heart, Activity, Phone, MapPin, ChevronRight, User,
  Zap, Shield, Thermometer, Pill, Users, Radio
} from 'lucide-react';

// ── Fix Leaflet icons in Vite ─────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Tokens ────────────────────────────────────────────────────────────────
const T = {
  bg0: '#06080f', bg1: '#0d1117', bg2: '#161b22', bg3: '#21262d',
  border: '#30363d', text1: '#e6edf3', text2: '#7d8590', text3: '#484f58',
  blue: '#388bfd', blueDim: '#1f3358', green: '#3fb950', greenDim: '#1a3a1f',
  red: '#f85149', redDim: '#3d1f1f', amber: '#d29922', amberDim: '#2d2008',
  purple: '#a371f7', purpleDim: '#2d1f4e',
  font: "'Syne', sans-serif", body: "'DM Sans', sans-serif",
};

const sevColor = (s) => s === 'Critical' ? T.red : s === 'High' ? T.amber : T.green;
const sevBg    = (s) => s === 'Critical' ? T.redDim : s === 'High' ? T.amberDim : T.greenDim;

// ── Custom victim marker ──────────────────────────────────────────────────
function makeVictimIcon(severity) {
  const color = sevColor(severity);
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
      <path d="M16 0C7 0 0 7 0 16C0 26 16 40 16 40C16 40 32 26 32 16C32 7 25 0 16 0Z" fill="${color}"/>
      <circle cx="16" cy="16" r="9" fill="rgba(255,255,255,0.15)"/>
      <text x="16" y="20" text-anchor="middle" font-family="Syne,sans-serif" font-size="9" font-weight="800" fill="white">SOS</text>
    </svg>`,
    className: '', iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -40],
  });
}

function makeAmbIcon() {
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <rect x="2" y="2" width="32" height="32" rx="8" fill="#388bfd"/>
      <text x="18" y="23" text-anchor="middle" font-family="Syne,sans-serif" font-size="11" font-weight="800" fill="white">AMB</text>
    </svg>`,
    className: '', iconSize: [36, 36], iconAnchor: [18, 18],
  });
}

// ── MapFlyTo ──────────────────────────────────────────────────────────────
function MapFlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 15, { duration: 1.2 });
  }, [target, map]);
  return null;
}

// ── Mock medical vault (in real app fetched from DB by emergency id) ──────
const MOCK_VAULT = {
  name: 'Rohan Shaw', age: 28, bloodType: 'A+',
  allergies: ['Penicillin', 'Sulfa drugs'],
  conditions: ['Type 2 Diabetes', 'Hypertension'],
  medications: [
    { name: 'Metformin', dose: '500mg twice daily' },
    { name: 'Lisinopril', dose: '10mg once daily' },
  ],
  doctorName: 'Dr. Kavitha Rajan',
  hospital: 'Apollo Hospitals, Chennai',
  contacts: [
    { name: 'Priya Shaw', rel: 'Mother', phone: '+91 98765 43210' },
  ],
};

// ── Responder status machine ──────────────────────────────────────────────
const STATUS_FLOW = ['idle', 'dispatched', 'en_route', 'arrived', 'completed'];
const STATUS_LABEL = {
  idle:       'Standby',
  dispatched: 'Dispatch Received',
  en_route:   'En Route',
  arrived:    'On Scene',
  completed:  'Completed',
};
const STATUS_COLOR = {
  idle: T.text2, dispatched: T.amber, en_route: T.blue, arrived: T.green, completed: T.purple,
};

// ═════════════════════════════════════════════════════════════════════════════
export default function Responder() {
  const [status,       setStatus]       = useState('idle');
  const [activeJob,    setActiveJob]    = useState(null);   // current emergency
  const [pendingJobs,  setPendingJobs]  = useState([]);     // incoming SOS queue
  const [victimLoc,    setVictimLoc]    = useState(null);   // live victim coords
  const [ambLoc,       setAmbLoc]       = useState(null);   // our GPS position
  const [mapTarget,    setMapTarget]    = useState(null);
  const [tab,          setTab]          = useState('map');  // map | vitals | vault
  const [connected,    setConnected]    = useState(false);
  const socketRef = useRef(null);
  const watchRef  = useRef(null);

  // ── Own GPS ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setAmbLoc(loc);
        // Broadcast responder position to server
        socketRef.current?.emit('responder_location', {
          responder_id: 'amb-up14',
          ...loc,
        });
      },
      null,
      { enableHighAccuracy: true, maximumAge: 4000 }
    );
    return () => navigator.geolocation.clearWatch(watchRef.current);
  }, []);

  // ── Socket ────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io('http://localhost:8000');
    socketRef.current = socket;

    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    // Incoming SOS
    socket.on('new_emergency', (emergency) => {
      setPendingJobs(prev => [emergency, ...prev]);
    });

    // Victim sharing live location
    socket.on('victim_location_update', ({ emergency_id, latitude, longitude }) => {
      if (activeJob?.id === emergency_id) {
        const loc = { lat: parseFloat(latitude), lng: parseFloat(longitude) };
        setVictimLoc(loc);
        setMapTarget(loc);
      }
    });

    return () => socket.disconnect();
  }, [activeJob]);

  // ── Accept a dispatch ─────────────────────────────────────────────────
  const acceptJob = useCallback((job) => {
    setActiveJob(job);
    setPendingJobs(prev => prev.filter(j => j.id !== job.id));
    setStatus('en_route');
    setTab('map');
    const loc = { lat: parseFloat(job.latitude), lng: parseFloat(job.longitude) };
    setMapTarget(loc);
    socketRef.current?.emit('dispatch_accepted', { emergency_id: job.id, responder_id: 'amb-up14' });
  }, []);

  const declineJob = useCallback((jobId) => {
    setPendingJobs(prev => prev.filter(j => j.id !== jobId));
  }, []);

  const advanceStatus = useCallback(() => {
    const next = {
      en_route: 'arrived',
      arrived:  'completed',
      completed: 'idle',
    }[status];
    if (!next) return;
    if (next === 'idle') { setActiveJob(null); setVictimLoc(null); }
    setStatus(next);
    socketRef.current?.emit('responder_status_update', {
      emergency_id: activeJob?.id,
      status: next,
    });
  }, [status, activeJob]);

  // ── ETA countdown (mock) ──────────────────────────────────────────────
  const [eta, setEta] = useState(4 * 60); // 4 min in seconds
  useEffect(() => {
    if (status !== 'en_route') return;
    const t = setInterval(() => setEta(e => Math.max(0, e - 1)), 1000);
    return () => clearInterval(t);
  }, [status]);
  const etaStr = `${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, '0')}`;

  return (
    <div style={{
      minHeight: '100vh', width: '100vw',
      background: T.bg0, color: T.text1,
      fontFamily: T.body,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ── TOP BAR ───────────────────────────────────────────────────── */}
      <div style={{
        background: T.bg1, borderBottom: `1px solid ${T.border}`,
        padding: '0 20px', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: T.blueDim, border: `1px solid ${T.blue}33`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Navigation size={16} color={T.blue} />
          </div>
          <div>
            <p style={{ margin: 0, fontFamily: T.font, fontWeight: 700, fontSize: 14, color: T.text1 }}>
              Unit UP-14
            </p>
            <p style={{ margin: 0, fontSize: 10, color: T.text2 }}>Advanced Life Support</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Pending badge */}
          {pendingJobs.length > 0 && (
            <div style={{
              background: T.redDim, border: `1px solid ${T.red}44`,
              borderRadius: 20, padding: '4px 10px',
              display: 'flex', alignItems: 'center', gap: 5,
              animation: 'lb-pulse 1.2s infinite',
            }}>
              <AlertTriangle size={11} color={T.red} />
              <span style={{ fontSize: 11, color: T.red, fontFamily: T.font, fontWeight: 700 }}>
                {pendingJobs.length} INCOMING
              </span>
            </div>
          )}
          {/* Status pill */}
          <div style={{
            background: T.bg2, border: `1px solid ${T.border}`,
            borderRadius: 20, padding: '5px 12px',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: STATUS_COLOR[status],
              display: 'inline-block',
              animation: status !== 'idle' ? 'lb-pulse 2s infinite' : 'none',
            }} />
            <span style={{ fontSize: 11, color: STATUS_COLOR[status], fontFamily: T.font, fontWeight: 700, letterSpacing: .5 }}>
              {STATUS_LABEL[status].toUpperCase()}
            </span>
          </div>
          {/* Connection dot */}
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? T.green : T.red,
          }} />
        </div>
      </div>

      {/* ── PENDING DISPATCH ALERTS ───────────────────────────────────── */}
      {pendingJobs.length > 0 && (
        <div style={{ padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          {pendingJobs.map(job => (
            <DispatchAlert key={job.id} job={job} onAccept={() => acceptJob(job)} onDecline={() => declineJob(job.id)} />
          ))}
        </div>
      )}

      {/* ── MAIN CONTENT ──────────────────────────────────────────────── */}
      {activeJob ? (
        <ActiveMission
          job={activeJob} status={status} eta={etaStr}
          victimLoc={victimLoc} ambLoc={ambLoc} mapTarget={mapTarget}
          tab={tab} setTab={setTab}
          onAdvance={advanceStatus}
        />
      ) : (
        <IdleScreen connected={connected} />
      )}
    </div>
  );
}

// ── Incoming dispatch alert card ──────────────────────────────────────────
function DispatchAlert({ job, onAccept, onDecline }) {
  const color = sevColor(job.severity_score);
  const bg    = sevBg(job.severity_score);

  return (
    <div style={{
      background: bg, border: `1.5px solid ${color}44`,
      borderRadius: 14, padding: '14px 16px',
      animation: 'lb-fadein .25s ease',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontFamily: T.font, fontWeight: 800, fontSize: 13, color,
              letterSpacing: 1,
            }}>
              SOS #{job.id} — {(job.severity_score || 'UNKNOWN').toUpperCase()}
            </span>
          </div>
          <span style={{ fontSize: 11, color: T.text2 }}>
            {parseFloat(job.latitude).toFixed(4)}, {parseFloat(job.longitude).toFixed(4)}
          </span>
        </div>
        <span style={{ fontSize: 11, color: T.text2 }}>
          {new Date(job.created_at).toLocaleTimeString()}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onAccept} style={{
          flex: 2, padding: '10px 0',
          background: T.greenDim, border: `1px solid ${T.green}55`,
          borderRadius: 10, color: T.green,
          fontFamily: T.font, fontWeight: 700, fontSize: 12, letterSpacing: 1,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          transition: 'all .15s',
        }}>
          <CheckCircle size={14} /> ACCEPT DISPATCH
        </button>
        <button onClick={onDecline} style={{
          flex: 1, padding: '10px 0',
          background: 'transparent', border: `1px solid ${T.border}`,
          borderRadius: 10, color: T.text2,
          fontFamily: T.font, fontWeight: 700, fontSize: 12, letterSpacing: 1,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <XCircle size={14} /> DECLINE
        </button>
      </div>
    </div>
  );
}

// ── Idle screen ───────────────────────────────────────────────────────────
function IdleScreen({ connected }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: 32, textAlign: 'center',
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: T.bg2, border: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Radio size={32} color={T.text3} />
      </div>
      <div>
        <p style={{ fontFamily: T.font, fontWeight: 700, fontSize: 20, color: T.text1, margin: '0 0 8px' }}>
          Unit UP-14 — Standby
        </p>
        <p style={{ fontSize: 13, color: T.text2, margin: 0, lineHeight: 1.6 }}>
          {connected
            ? 'Connected to dispatch. Awaiting incoming SOS signals.'
            : 'Connecting to dispatch server...'}
        </p>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%', maxWidth: 400, marginTop: 8,
      }}>
        {[
          { label: 'Unit ID',   val: 'UP-14',       icon: <Navigation size={14} /> },
          { label: 'Type',      val: 'ALS',          icon: <Activity size={14} /> },
          { label: 'Crew',      val: '3 Personnel',  icon: <Users size={14} /> },
          { label: 'Status',    val: 'In Service',   icon: <CheckCircle size={14} /> },
        ].map(({ label, val, icon }) => (
          <div key={label} style={{
            background: T.bg2, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.text2, marginBottom: 6 }}>
              {icon}
              <span style={{ fontSize: 11 }}>{label}</span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 500, color: T.text1 }}>{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Active mission ────────────────────────────────────────────────────────
function ActiveMission({ job, status, eta, victimLoc, ambLoc, mapTarget, tab, setTab, onAdvance }) {
  const color = sevColor(job.severity_score);

  const NEXT_ACTION = {
    en_route: { label: 'MARK ARRIVED ON SCENE', color: T.green, bg: T.greenDim },
    arrived:  { label: 'MARK CASE COMPLETED',   color: T.purple, bg: T.purpleDim },
    completed:{ label: 'RETURN TO STANDBY',     color: T.text2,  bg: T.bg3 },
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Mission header */}
      <div style={{
        background: `linear-gradient(135deg, ${sevBg(job.severity_score)}, ${T.bg2})`,
        borderBottom: `1px solid ${color}33`,
        padding: '12px 20px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontFamily: T.font, fontWeight: 800, fontSize: 16, color }}>
              SOS #{job.id} — {(job.severity_score || 'UNKNOWN').toUpperCase()}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              {victimLoc && (
                <span style={{
                  fontSize: 10, color: T.green, background: T.greenDim,
                  border: `1px solid ${T.green}33`, borderRadius: 4, padding: '2px 7px',
                  fontFamily: T.font, fontWeight: 700,
                }}>
                  LIVE LOC
                </span>
              )}
              <span style={{ fontSize: 11, color: T.text2 }}>
                {new Date(job.created_at).toLocaleTimeString()}
              </span>
            </div>
          </div>
          {status === 'en_route' && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 28, color: T.amber, lineHeight: 1 }}>
                {eta}
              </div>
              <div style={{ fontSize: 10, color: T.text2, marginTop: 2 }}>ETA</div>
            </div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', background: T.bg1, borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}>
        {[
          { id: 'map',   label: 'Navigation', icon: <MapPin size={14} /> },
          { id: 'vitals',label: 'Vitals',     icon: <Activity size={14} /> },
          { id: 'vault', label: 'Med Vault',  icon: <Shield size={14} /> },
        ].map(({ id, label, icon }) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, padding: '12px 8px',
            background: 'transparent',
            border: 'none',
            borderBottom: tab === id ? `2px solid ${T.blue}` : '2px solid transparent',
            color: tab === id ? T.blue : T.text2,
            fontFamily: T.font, fontWeight: 700, fontSize: 11, letterSpacing: 1,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            transition: 'all .15s',
          }}>
            {icon} {label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'map'    && <NavTab job={job} victimLoc={victimLoc} ambLoc={ambLoc} mapTarget={mapTarget} status={status} />}
        {tab === 'vitals' && <VitalsTab job={job} victimLoc={victimLoc} />}
        {tab === 'vault'  && <VaultTab />}
      </div>

      {/* Action button */}
      {NEXT_ACTION[status] && (
        <div style={{ padding: '12px 16px 20px', flexShrink: 0, background: T.bg1, borderTop: `1px solid ${T.border}` }}>
          <button onClick={onAdvance} style={{
            width: '100%', padding: '14px 0',
            background: NEXT_ACTION[status].bg,
            border: `1px solid ${NEXT_ACTION[status].color}44`,
            borderRadius: 12, color: NEXT_ACTION[status].color,
            fontFamily: T.font, fontWeight: 800, fontSize: 13, letterSpacing: 1.5,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'all .15s',
          }}>
            <ChevronRight size={16} />
            {NEXT_ACTION[status].label}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Navigation tab ────────────────────────────────────────────────────────
function NavTab({ job, victimLoc, ambLoc, mapTarget }) {
  const victimPos = victimLoc
    ? [victimLoc.lat, victimLoc.lng]
    : [parseFloat(job.latitude), parseFloat(job.longitude)];

  const center = ambLoc ? [ambLoc.lat, ambLoc.lng] : victimPos;

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap contributors'
        />
        <MapFlyTo target={mapTarget} />

        {/* Victim marker */}
        <Marker position={victimPos} icon={makeVictimIcon(job.severity_score)}>
          <Popup>
            <div style={{ fontFamily: T.body, fontSize: 13 }}>
              <strong style={{ color: sevColor(job.severity_score) }}>SOS #{job.id}</strong><br />
              {victimLoc ? '🟢 Live location' : 'Last known location'}
            </div>
          </Popup>
        </Marker>

        {/* Ambulance marker */}
        {ambLoc && (
          <Marker position={[ambLoc.lat, ambLoc.lng]} icon={makeAmbIcon()}>
            <Popup><div style={{ fontFamily: T.body, fontSize: 13 }}>📍 Your position — UP-14</div></Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Live location badge overlay */}
      {victimLoc && (
        <div style={{
          position: 'absolute', top: 12, left: 12, zIndex: 999,
          background: 'rgba(13,26,13,0.9)', border: `1px solid ${T.green}44`,
          borderRadius: 8, padding: '6px 12px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.green, animation: 'lb-pulse 1.5s infinite', display: 'inline-block' }} />
          <span style={{ fontSize: 11, color: '#4ade80', fontFamily: T.font, fontWeight: 700 }}>
            VICTIM LIVE · {victimLoc.lat.toFixed(4)}, {victimLoc.lng.toFixed(4)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Vitals tab ────────────────────────────────────────────────────────────
function VitalsTab({ job }) {
  // In real app these would stream from IoT sensors or victim input
  const vitals = [
    { label: 'Severity',    val: job.severity_score || 'Unknown', icon: <Zap size={16} />,         color: sevColor(job.severity_score) },
    { label: 'Breathing',   val: 'Labored',                        icon: <Activity size={16} />,    color: T.amber },
    { label: 'Conscious',   val: 'Awake',                          icon: <User size={16} />,        color: T.green },
    { label: 'Blood Loss',  val: 'Moderate',                       icon: <Heart size={16} />,       color: T.red },
    { label: 'Temperature', val: '37.2°C',                         icon: <Thermometer size={16} />, color: T.text1 },
    { label: 'Inc. Type',   val: 'Medical',                        icon: <AlertTriangle size={16}/>, color: T.blue },
  ];

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14,
      }}>
        {vitals.map(({ label, val, icon, color }) => (
          <div key={label} style={{
            background: T.bg2, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: T.text2 }}>
              <span style={{ color }}>{icon}</span>
              <span style={{ fontSize: 11 }}>{label}</span>
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, color, fontFamily: T.font }}>{val}</span>
          </div>
        ))}
      </div>

      {/* Location coords */}
      <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: T.text2 }}>
          <MapPin size={13} />
          <span style={{ fontSize: 11 }}>Last Known Coordinates</span>
        </div>
        <span style={{ fontSize: 13, color: T.text1, fontFamily: 'monospace' }}>
          {parseFloat(job.latitude).toFixed(6)}, {parseFloat(job.longitude).toFixed(6)}
        </span>
      </div>
    </div>
  );
}

// ── Vault tab ─────────────────────────────────────────────────────────────
function VaultTab() {
  const v = MOCK_VAULT;
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Patient header */}
      <div style={{
        background: T.bg2, border: `1px solid ${T.border}`,
        borderRadius: 14, padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: T.blueDim, border: `1px solid ${T.blue}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: T.font, fontWeight: 700, fontSize: 16, color: T.blue,
          flexShrink: 0,
        }}>
          {v.name.split(' ').map(w => w[0]).join('')}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: T.text1 }}>{v.name}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: T.text2 }}>Age {v.age} · {v.doctorName}</p>
        </div>
        <div style={{
          background: '#3d1f1f', border: `1px solid ${T.red}44`,
          borderRadius: 8, padding: '6px 12px', textAlign: 'center',
        }}>
          <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 20, color: T.red }}>{v.bloodType}</div>
          <div style={{ fontSize: 9, color: T.text2, letterSpacing: 1 }}>BLOOD</div>
        </div>
      </div>

      {/* Allergies */}
      <VaultRow title="ALLERGIES" color={T.red} bg="#3d1f1f">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {v.allergies.map(a => (
            <span key={a} style={{
              background: '#3d1f1f', color: T.red, border: `1px solid ${T.red}33`,
              borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 500,
            }}>{a}</span>
          ))}
        </div>
      </VaultRow>

      {/* Conditions */}
      <VaultRow title="CONDITIONS" color={T.amber} bg={T.amberDim}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {v.conditions.map(c => (
            <span key={c} style={{
              background: T.amberDim, color: T.amber, border: `1px solid ${T.amber}33`,
              borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 500,
            }}>{c}</span>
          ))}
        </div>
      </VaultRow>

      {/* Medications */}
      <VaultRow title="MEDICATIONS" color={T.blue} bg={T.blueDim}>
        {v.medications.map(m => (
          <div key={m.name} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '5px 0', borderBottom: `1px solid ${T.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Pill size={12} color={T.blue} />
              <span style={{ fontSize: 13, color: T.text1 }}>{m.name}</span>
            </div>
            <span style={{ fontSize: 11, color: '#60a5fa', background: T.blueDim, borderRadius: 5, padding: '2px 8px' }}>{m.dose}</span>
          </div>
        ))}
      </VaultRow>

      {/* Emergency contact */}
      <VaultRow title="EMERGENCY CONTACT" color={T.green} bg={T.greenDim}>
        {v.contacts.map(c => (
          <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 500, color: T.text1 }}>{c.name}</span>
              <span style={{ fontSize: 11, color: T.text2, marginLeft: 8 }}>{c.rel}</span>
            </div>
            <a href={`tel:${c.phone}`} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: T.greenDim, border: `1px solid ${T.green}33`,
              borderRadius: 8, padding: '5px 10px',
              color: T.green, fontSize: 12, fontWeight: 500, textDecoration: 'none',
            }}>
              <Phone size={12} /> {c.phone}
            </a>
          </div>
        ))}
      </VaultRow>
    </div>
  );
}

function VaultRow({ title, color, bg, children }) {
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color, letterSpacing: 1.5, marginBottom: 10, fontFamily: T.font, fontWeight: 700 }}>{title}</div>
      {children}
    </div>
  );
}
