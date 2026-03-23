import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  Activity, AlertTriangle, CheckCircle, Clock, Heart,
  Users, TrendingUp, Ambulance, FileText, Shield,
  ChevronRight, X, Phone, Pill, User, MapPin
} from 'lucide-react';

// ── Tokens ────────────────────────────────────────────────────────────────
const T = {
  bg0: '#040d1a', bg1: '#071428', bg2: '#0d1f3c', bg3: '#122852',
  border: '#1a3054', text1: '#e8f0fe', text2: '#6b8cba', text3: '#3a5278',
  blue: '#4da6ff', blueDim: '#0d2040',
  green: '#22c55e', greenDim: '#0d2010',
  red: '#f85149', redDim: '#2d0a08',
  amber: '#f59e0b', amberDim: '#2d1a00',
  purple: '#a78bfa', purpleDim: '#1e1040',
  teal: '#2dd4bf', tealDim: '#0a2028',
  font: "'Syne', sans-serif", body: "'DM Sans', sans-serif",
};

const sevColor = (s) => s === 'Critical' ? T.red : s === 'High' ? T.amber : T.green;
const sevBg    = (s) => s === 'Critical' ? T.redDim : s === 'High' ? T.amberDim : T.greenDim;

// ── Mock vault per emergency (real app: fetch by emergency id) ────────────
const MOCK_VAULT = {
  name: 'Rohan Shaw', age: 28, bloodType: 'A+',
  allergies: ['Penicillin', 'Sulfa drugs'],
  conditions: ['Type 2 Diabetes', 'Hypertension'],
  medications: [
    { name: 'Metformin', dose: '500mg twice daily' },
    { name: 'Lisinopril', dose: '10mg once daily' },
  ],
  doctorName: 'Dr. Kavitha Rajan',
  contacts: [{ name: 'Priya Shaw', rel: 'Mother', phone: '+91 98765 43210' }],
};

// ═════════════════════════════════════════════════════════════════════════════
export default function HospitalDashboard() {
  const [emergencies,  setEmergencies]  = useState([]);
  const [resolved,     setResolved]     = useState([]);
  const [selected,     setSelected]     = useState(null); // emergency for passport modal
  const [connected,    setConnected]    = useState(false);
  const [stats,        setStats]        = useState({ total: 0, critical: 0, high: 0, low: 0, avgEta: 4 });
  const socketRef = useRef(null);

  // ── Socket ────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io('http://localhost:8000');
    socketRef.current = socket;
    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('new_emergency', (e) => {
      setEmergencies(prev => [e, ...prev]);
    });
    socket.on('emergency_resolved', ({ id }) => {
      setEmergencies(prev => {
        const found = prev.find(e => e.id === id);
        if (found) setResolved(r => [{ ...found, resolved_at: new Date().toISOString() }, ...r]);
        return prev.filter(e => e.id !== id);
      });
    });

    return () => socket.disconnect();
  }, []);

  // ── Initial fetch ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch('http://localhost:8000/api/emergencies')
      .then(r => r.json())
      .then(data => setEmergencies(data))
      .catch(() => {});
  }, []);

  // ── Stats ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setStats({
      total:    emergencies.length,
      critical: emergencies.filter(e => e.severity_score === 'Critical').length,
      high:     emergencies.filter(e => e.severity_score === 'High').length,
      low:      emergencies.filter(e => !['Critical','High'].includes(e.severity_score)).length,
      avgEta:   4,
    });
  }, [emergencies]);

  return (
    <div style={{
      minHeight: '100vh', width: '100vw',
      background: T.bg0, color: T.text1,
      fontFamily: T.body, display: 'flex', flexDirection: 'column',
    }}>

      {/* ── HEADER ───────────────────────────────────────────────────── */}
      <div style={{
        background: T.bg1, borderBottom: `1px solid ${T.border}`,
        padding: '0 28px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: T.blueDim, border: `1px solid ${T.blue}33`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Heart size={18} color={T.blue} />
          </div>
          <div>
            <p style={{ margin: 0, fontFamily: T.font, fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>
              LiveBridge Hospital
            </p>
            <p style={{ margin: 0, fontSize: 10, color: T.text2 }}>Emergency Intake Dashboard</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: T.text2 }}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: connected ? T.greenDim : T.redDim,
            border: `1px solid ${connected ? T.green : T.red}33`,
            borderRadius: 20, padding: '4px 10px',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: connected ? T.green : T.red, display: 'inline-block',
            }} />
            <span style={{ fontSize: 11, color: connected ? T.green : T.red, fontFamily: T.font, fontWeight: 700 }}>
              {connected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── LEFT: STATS + INCIDENT QUEUE ─────────────────────────── */}
        <div style={{
          width: 340, background: T.bg1,
          borderRight: `1px solid ${T.border}`,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden', flexShrink: 0,
        }}>
          {/* Stat cards */}
          <div style={{ padding: '16px 16px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'Active SOS',   val: stats.total,    color: T.blue,   bg: T.blueDim,   icon: <Activity size={14} /> },
              { label: 'Critical',     val: stats.critical, color: T.red,    bg: T.redDim,    icon: <AlertTriangle size={14} /> },
              { label: 'High',         val: stats.high,     color: T.amber,  bg: T.amberDim,  icon: <TrendingUp size={14} /> },
              { label: 'Avg ETA',      val: `${stats.avgEta}m`, color: T.green, bg: T.greenDim, icon: <Clock size={14} /> },
            ].map(({ label, val, color, bg, icon }) => (
              <div key={label} style={{
                background: bg, border: `1px solid ${color}22`,
                borderRadius: 10, padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: T.text2, marginBottom: 4 }}>
                  <span style={{ color }}>{icon}</span>
                  <span style={{ fontSize: 10 }}>{label}</span>
                </div>
                <span style={{ fontFamily: T.font, fontWeight: 800, fontSize: 22, color }}>{val}</span>
              </div>
            ))}
          </div>

          {/* Incident queue */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
            <div style={{
              fontSize: 10, letterSpacing: 2, color: T.text3,
              fontFamily: T.font, fontWeight: 700, marginBottom: 10,
            }}>
              INCIDENT QUEUE
            </div>

            {emergencies.length === 0 && (
              <div style={{ textAlign: 'center', padding: '28px 0', color: T.text3 }}>
                <CheckCircle size={28} color={T.green} style={{ marginBottom: 8 }} />
                <p style={{ fontSize: 13, margin: 0 }}>No active incidents</p>
              </div>
            )}

            {emergencies.map((e, idx) => (
              <IncidentCard
                key={e.id}
                emergency={e}
                isSelected={selected?.id === e.id}
                onClick={() => setSelected(selected?.id === e.id ? null : e)}
                rank={idx + 1}
              />
            ))}

            {/* Resolved section */}
            {resolved.length > 0 && (
              <>
                <div style={{
                  fontSize: 10, letterSpacing: 2, color: T.text3,
                  fontFamily: T.font, fontWeight: 700, margin: '16px 0 8px',
                }}>
                  RECENTLY RESOLVED
                </div>
                {resolved.slice(0, 5).map(e => (
                  <div key={e.id} style={{
                    background: T.bg2, border: `1px solid ${T.border}`,
                    borderRadius: 10, padding: '10px 12px', marginBottom: 6,
                    opacity: .6,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: T.text2 }}>SOS #{e.id}</span>
                      <span style={{
                        fontSize: 9, color: T.green, background: T.greenDim,
                        borderRadius: 4, padding: '2px 6px', fontFamily: T.font, fontWeight: 700,
                      }}>RESOLVED</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* ── RIGHT: MEDICAL PASSPORT VIEWER ──────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {selected ? (
            <MedicalPassport emergency={selected} onClose={() => setSelected(null)} />
          ) : (
            <EmptyPassport />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Incident card ─────────────────────────────────────────────────────────
function IncidentCard({ emergency: e, isSelected, onClick, rank }) {
  const color = sevColor(e.severity_score);
  return (
    <div onClick={onClick} style={{
      background: isSelected ? T.bg3 : T.bg2,
      border: `1px solid ${isSelected ? T.blue : T.border}`,
      borderRadius: 12, padding: '12px 14px', marginBottom: 8,
      cursor: 'pointer', transition: 'all .15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            background: `${color}22`, border: `1px solid ${color}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontFamily: T.font, fontWeight: 800, color,
          }}>
            {rank}
          </div>
          <span style={{ fontFamily: T.font, fontWeight: 700, fontSize: 13, color: T.text1 }}>
            SOS #{e.id}
          </span>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 1,
          color, background: `${color}18`,
          border: `1px solid ${color}33`,
          borderRadius: 5, padding: '2px 7px', fontFamily: T.font,
        }}>
          {(e.severity_score || 'UNKNOWN').toUpperCase()}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: T.text2, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={10} /> {new Date(e.created_at).toLocaleTimeString()}
        </span>
        <span style={{ fontSize: 11, color: T.text2, display: 'flex', alignItems: 'center', gap: 4 }}>
          <MapPin size={10} />
          {parseFloat(e.latitude).toFixed(3)}, {parseFloat(e.longitude).toFixed(3)}
        </span>
      </div>
      {isSelected && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, color: T.blue }}>
          <FileText size={11} />
          <span style={{ fontSize: 11, fontFamily: T.font, fontWeight: 700 }}>VIEWING MEDICAL PASSPORT →</span>
        </div>
      )}
    </div>
  );
}

// ── Medical Passport viewer ───────────────────────────────────────────────
function MedicalPassport({ emergency: e, onClose }) {
  const v = MOCK_VAULT; // In real app: fetch vault by emergency/user id
  const color = sevColor(e.severity_score);

  return (
    <div style={{ animation: 'lb-fadein .2s ease', maxWidth: 720 }}>
      {/* Passport header */}
      <div style={{
        background: T.bg2, border: `1px solid ${T.border}`,
        borderRadius: 16, padding: '20px 24px', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: T.blueDim, border: `1px solid ${T.blue}33`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: T.font, fontWeight: 800, fontSize: 18, color: T.blue,
          }}>
            {v.name.split(' ').map(w => w[0]).join('')}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <p style={{ margin: 0, fontFamily: T.font, fontWeight: 700, fontSize: 18, color: T.text1 }}>{v.name}</p>
              <span style={{
                fontSize: 9, fontWeight: 700, color, background: `${color}18`,
                border: `1px solid ${color}33`, borderRadius: 5, padding: '3px 8px',
                fontFamily: T.font, letterSpacing: 1,
              }}>
                {(e.severity_score || 'UNKNOWN').toUpperCase()}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: T.text2 }}>
              Age {v.age} · SOS #{e.id} · {new Date(e.created_at).toLocaleTimeString()}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            background: T.redDim, border: `1px solid ${T.red}44`,
            borderRadius: 10, padding: '10px 16px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 26, color: T.red, lineHeight: 1 }}>{v.bloodType}</div>
            <div style={{ fontSize: 9, color: T.text2, letterSpacing: 1, marginTop: 2 }}>BLOOD TYPE</div>
          </div>
          <button onClick={onClose} style={{
            background: T.bg3, border: `1px solid ${T.border}`, borderRadius: '50%',
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: T.text2,
          }}>
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Passport body — 2 column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

        {/* Allergies */}
        <PassportSection title="ALLERGIES" icon={<AlertTriangle size={13} />} color={T.red}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {v.allergies.map(a => (
              <span key={a} style={{
                background: T.redDim, color: T.red,
                border: `1px solid ${T.red}33`, borderRadius: 6,
                padding: '4px 10px', fontSize: 12, fontWeight: 500,
              }}>{a}</span>
            ))}
          </div>
        </PassportSection>

        {/* Conditions */}
        <PassportSection title="CONDITIONS" icon={<Heart size={13} />} color={T.amber}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {v.conditions.map(c => (
              <span key={c} style={{
                background: T.amberDim, color: T.amber,
                border: `1px solid ${T.amber}33`, borderRadius: 6,
                padding: '4px 10px', fontSize: 12, fontWeight: 500,
              }}>{c}</span>
            ))}
          </div>
        </PassportSection>

        {/* Medications — full width */}
        <div style={{ gridColumn: 'span 2' }}>
          <PassportSection title="CURRENT MEDICATIONS" icon={<Pill size={13} />} color={T.blue}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {v.medications.map(m => (
                <div key={m.name} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: T.bg3, borderRadius: 8, padding: '8px 12px',
                }}>
                  <span style={{ fontSize: 13, color: T.text1 }}>{m.name}</span>
                  <span style={{
                    fontSize: 11, color: T.blue,
                    background: T.blueDim, borderRadius: 5, padding: '2px 8px',
                  }}>{m.dose}</span>
                </div>
              ))}
            </div>
          </PassportSection>
        </div>

        {/* Primary doctor */}
        <PassportSection title="PRIMARY DOCTOR" icon={<User size={13} />} color={T.teal}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: T.text1 }}>{v.doctorName}</p>
        </PassportSection>

        {/* Emergency contact */}
        <PassportSection title="EMERGENCY CONTACT" icon={<Phone size={13} />} color={T.green}>
          {v.contacts.map(c => (
            <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: T.text1 }}>{c.name}</p>
                <p style={{ margin: 0, fontSize: 11, color: T.text2 }}>{c.rel}</p>
              </div>
              <a href={`tel:${c.phone}`} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: T.greenDim, border: `1px solid ${T.green}33`,
                borderRadius: 8, padding: '5px 10px',
                color: T.green, fontSize: 11, textDecoration: 'none',
              }}>
                <Phone size={11} /> Call
              </a>
            </div>
          ))}
        </PassportSection>

        {/* Location */}
        <div style={{ gridColumn: 'span 2' }}>
          <PassportSection title="INCIDENT LOCATION" icon={<MapPin size={13} />} color={T.purple}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: T.text1 }}>
                {parseFloat(e.latitude).toFixed(6)}, {parseFloat(e.longitude).toFixed(6)}
              </span>
              <span style={{
                fontSize: 11, color: T.text2, background: T.bg3,
                borderRadius: 6, padding: '3px 10px',
              }}>
                Reported {new Date(e.created_at).toLocaleTimeString()}
              </span>
            </div>
          </PassportSection>
        </div>
      </div>
    </div>
  );
}

function PassportSection({ title, icon, color, children }) {
  return (
    <div style={{
      background: T.bg2, border: `1px solid ${T.border}`,
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 12, color,
      }}>
        {icon}
        <span style={{ fontSize: 10, fontFamily: T.font, fontWeight: 700, letterSpacing: 1.5 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function EmptyPassport() {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', gap: 14,
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: T.bg2, border: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <FileText size={28} color={T.text3} />
      </div>
      <div>
        <p style={{ fontFamily: T.font, fontWeight: 700, fontSize: 18, color: T.text1, margin: '0 0 8px' }}>
          Medical Passport Viewer
        </p>
        <p style={{ fontSize: 13, color: T.text2, margin: 0, lineHeight: 1.7, maxWidth: 360 }}>
          Select an incident from the queue to view the patient's full medical passport — blood type, allergies, medications, conditions and emergency contacts.
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.text3 }}>
        <Shield size={13} />
        <span style={{ fontSize: 12 }}>Data shared automatically at time of SOS</span>
      </div>
    </div>
  );
}
