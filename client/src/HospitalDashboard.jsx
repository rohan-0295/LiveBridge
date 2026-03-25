import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  Activity, AlertTriangle, CheckCircle, Clock, Heart,
  TrendingUp, FileText, Shield, X, Phone, Pill, User,
  MapPin, Video,
} from 'lucide-react';
import DoctorConnect from './DoctorConnect';

const T = {
  bg0: '#040d1a', bg1: '#071428', bg2: '#0d1f3c', bg3: '#122852',
  border: '#1a3054', text1: '#e8f0fe', text2: '#6b8cba', text3: '#3a5278',
  blue: '#4da6ff', blueDim: '#0d2040',
  green: '#22c55e', greenDim: '#0d2010',
  red: '#f85149', redDim: '#2d0a08',
  amber: '#f59e0b', amberDim: '#2d1a00',
  purple: '#a78bfa',
  teal: '#2dd4bf',
  font: "'Syne', sans-serif", body: "'DM Sans', sans-serif",
};

const sevColor = (s) => s === 'Critical' ? T.red  : s === 'High' ? T.amber  : T.green;

export default function HospitalDashboard() {
  const [emergencies,  setEmergencies]  = useState([]);
  const [resolved,     setResolved]     = useState([]);
  const [selected,     setSelected]     = useState(null);
  const [vault,        setVault]        = useState(null);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [connected,    setConnected]    = useState(false);
  const [showDoctor,   setShowDoctor]   = useState(false);
  const socketRef = useRef(null);

  const stats = {
    total:    emergencies.length,
    critical: emergencies.filter(e => e.severity_score === 'Critical').length,
    high:     emergencies.filter(e => e.severity_score === 'High').length,
  };

  useEffect(() => {
    const socket = io('http://localhost:8000');
    socketRef.current = socket;
    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('new_emergency', (e) => setEmergencies(prev => [e, ...prev]));
    socket.on('emergency_resolved', ({ id }) => {
      setEmergencies(prev => {
        const found = prev.find(e => e.id === id);
        if (found) setResolved(r => [{ ...found }, ...r]);
        return prev.filter(e => e.id !== id);
      });
      if (selected?.id === id) setSelected(null);
    });
    return () => socket.disconnect();
  }, [selected]);

  useEffect(() => {
    fetch('http://localhost:8000/api/emergencies')
      .then(r => r.json()).then(setEmergencies).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) { setVault(null); return; }
    setVaultLoading(true);
    fetch(`http://localhost:8000/api/vault/${selected.user_id}`)
      .then(r => r.ok ? r.json() : null)
      .then(setVault).catch(() => setVault(null))
      .finally(() => setVaultLoading(false));
  }, [selected?.id]);

  const criticalInbound = emergencies.find(e => e.severity_score === 'Critical');

  return (
    <div style={{ height: '100vh', width: '100vw', background: T.bg0, color: T.text1, fontFamily: T.body, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* TOP BAR */}
      <div style={{ background: T.bg1, borderBottom: `1px solid ${T.border}`, height: 52, display: 'flex', alignItems: 'center', padding: '0 20px', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: T.blueDim, border: `1px solid ${T.blue}33`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Heart size={16} color={T.blue} />
          </div>
          <div>
            <p style={{ margin: 0, fontFamily: T.font, fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>LiveBridge Hospital</p>
            <p style={{ margin: 0, fontSize: 9, color: T.text2 }}>Emergency Intake Dashboard</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: T.text2 }}>{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          {selected && (
            <button onClick={() => setShowDoctor(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: T.blueDim, border: `1px solid ${T.blue}44`, borderRadius: 7, padding: '5px 10px', color: '#60a5fa', fontSize: 10, fontFamily: T.font, fontWeight: 700, cursor: 'pointer', letterSpacing: .5 }}>
              <Video size={11} /> CONNECT TO PATIENT
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: connected ? T.greenDim : T.redDim, border: `1px solid ${connected ? T.green : T.red}33`, borderRadius: 20, padding: '3px 9px' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: connected ? T.green : T.red, display: 'inline-block' }} />
            <span style={{ fontSize: 9, color: connected ? T.green : T.red, fontFamily: T.font, fontWeight: 700 }}>{connected ? 'LIVE' : 'OFFLINE'}</span>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* LEFT */}
        <div style={{ width: 220, background: T.bg1, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '10px 10px 0' }}>
            {[
              { label: 'Active',   val: stats.total,    color: T.blue,  bg: T.blueDim,  icon: <Activity size={12} /> },
              { label: 'Critical', val: stats.critical, color: T.red,   bg: T.redDim,   icon: <AlertTriangle size={12} /> },
              { label: 'High',     val: stats.high,     color: T.amber, bg: T.amberDim, icon: <TrendingUp size={12} /> },
              { label: 'Avg ETA',  val: '4m',           color: T.green, bg: T.greenDim, icon: <Clock size={12} /> },
            ].map(({ label, val, color, bg, icon }) => (
              <div key={label} style={{ background: bg, border: `1px solid ${color}22`, borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: T.text2, marginBottom: 3 }}>
                  <span style={{ color }}>{icon}</span><span style={{ fontSize: 8 }}>{label}</span>
                </div>
                <span style={{ fontFamily: T.font, fontWeight: 800, fontSize: 18, color }}>{val}</span>
              </div>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
            <div style={{ fontSize: 8, letterSpacing: 2, color: T.text3, fontFamily: T.font, fontWeight: 700, padding: '0 10px 6px' }}>INCIDENT QUEUE</div>
            {emergencies.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px 10px', color: T.text3 }}>
                <CheckCircle size={20} color={T.green} style={{ marginBottom: 5 }} />
                <p style={{ fontSize: 11, margin: 0 }}>No active incidents</p>
              </div>
            )}
            {emergencies.map(e => {
              const isSel = selected?.id === e.id;
              const color = sevColor(e.severity_score);
              return (
                <div key={e.id} onClick={() => setSelected(isSel ? null : e)} style={{ padding: '8px 10px', borderBottom: `1px solid ${T.bg0}`, borderLeft: isSel ? `2px solid ${T.blue}` : '2px solid transparent', background: isSel ? T.bg2 : 'transparent', cursor: 'pointer', transition: 'all .12s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontFamily: T.font, fontWeight: 700, fontSize: 11, color: T.text1 }}>SOS #{e.id}</span>
                    <span style={{ fontSize: 8, fontWeight: 700, fontFamily: T.font, color, background: `${color}18`, border: `1px solid ${color}33`, borderRadius: 4, padding: '1px 5px', letterSpacing: .5 }}>
                      {(e.severity_score || 'UNK').toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: 9, color: T.text2 }}>{new Date(e.created_at).toLocaleTimeString()}</div>
                  {isSel && <div style={{ display: 'flex', alignItems: 'center', gap: 3, color: T.blue, marginTop: 4 }}><FileText size={9} /><span style={{ fontSize: 8, fontFamily: T.font, fontWeight: 700 }}>VIEWING PASSPORT →</span></div>}
                </div>
              );
            })}
            {resolved.length > 0 && (
              <>
                <div style={{ fontSize: 8, letterSpacing: 2, color: T.text3, fontFamily: T.font, fontWeight: 700, padding: '10px 10px 5px', marginTop: 4 }}>RECENTLY RESOLVED</div>
                {resolved.slice(0, 5).map(e => (
                  <div key={e.id} style={{ padding: '6px 10px', display: 'flex', justifyContent: 'space-between', opacity: .55 }}>
                    <span style={{ fontSize: 10, color: T.text2 }}>SOS #{e.id}</span>
                    <span style={{ fontSize: 8, color: T.green, background: T.greenDim, borderRadius: 4, padding: '1px 6px', fontFamily: T.font, fontWeight: 700 }}>RESOLVED</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: T.bg0 }}>
          {criticalInbound && (
            <div style={{ background: T.redDim, border: `1px solid ${T.red}44`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: T.red, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#f87171', fontWeight: 500, flex: 1 }}>Critical patient inbound — SOS #{criticalInbound.id} — Prepare trauma bay</span>
              <span style={{ fontSize: 10, color: T.text2 }}>{new Date(criticalInbound.created_at).toLocaleTimeString()}</span>
            </div>
          )}
          {selected
            ? <MedicalPassport emergency={selected} vault={vault} vaultLoading={vaultLoading} onClose={() => setSelected(null)} />
            : <EmptyPassport />
          }
        </div>
      </div>

      {showDoctor && selected && <DoctorConnect emergencyId={selected.id} role="doctor" onClose={() => setShowDoctor(false)} />}
    </div>
  );
}

function MedicalPassport({ emergency: e, vault: v, vaultLoading, onClose }) {
  const color = sevColor(e.severity_score);
  return (
    <div style={{ maxWidth: 760 }}>
      {/* Header */}
      <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: T.blueDim, border: `1px solid ${T.blue}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font, fontWeight: 800, fontSize: 14, color: T.blue, flexShrink: 0 }}>
            {v ? (v.name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() : '#' + e.id}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontFamily: T.font, fontWeight: 700, fontSize: 16, color: T.text1 }}>{v?.name || `Patient — SOS #${e.id}`}</span>
              <span style={{ fontSize: 8, fontWeight: 700, color, fontFamily: T.font, background: `${color}18`, border: `1px solid ${color}33`, borderRadius: 5, padding: '2px 7px', letterSpacing: .5 }}>
                {(e.severity_score || 'UNKNOWN').toUpperCase()}
              </span>
              {v && <span style={{ fontSize: 8, color: T.blue, background: T.blueDim, border: `1px solid ${T.blue}33`, borderRadius: 4, padding: '2px 7px', fontFamily: T.font, fontWeight: 700 }}>LIVE LOC</span>}
            </div>
            <p style={{ margin: 0, fontSize: 10, color: T.text2 }}>{v ? `Age ${v.age || '?'} · ` : ''}SOS #{e.id} · {new Date(e.created_at).toLocaleTimeString()}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: T.redDim, border: `1px solid ${T.red}44`, borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
            <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 22, color: T.red, lineHeight: 1 }}>{v?.blood_type || '—'}</div>
            <div style={{ fontSize: 8, color: T.text2, letterSpacing: 1, marginTop: 2 }}>BLOOD TYPE</div>
          </div>
          <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
            <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 18, color: T.amber, lineHeight: 1 }}>4 min</div>
            <div style={{ fontSize: 8, color: T.text2, letterSpacing: 1, marginTop: 2 }}>ETA</div>
          </div>
          <button onClick={onClose} style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: '50%', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: T.text2 }}>
            <X size={14} />
          </button>
        </div>
      </div>

      {vaultLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div style={{ width: 24, height: 24, border: `2px solid ${T.border}`, borderTopColor: T.blue, borderRadius: '50%', animation: 'lb-spin .8s linear infinite' }} /></div>}

      {!vaultLoading && !v && (
        <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 12, padding: '28px 20px', textAlign: 'center' }}>
          <Shield size={28} color={T.text3} style={{ marginBottom: 10 }} />
          <p style={{ color: T.text2, fontSize: 14, margin: '0 0 6px' }}>No medical vault on file for this patient.</p>
          <p style={{ color: T.text3, fontSize: 12, margin: 0 }}>Patient may not have set up their vault yet.</p>
        </div>
      )}

      {!vaultLoading && v && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <PPSection title="ALLERGIES" icon={<AlertTriangle size={11} />} color={T.red}>
            {!(v.allergies?.length) ? <NoRecord /> : <TagRow items={v.allergies} color={T.red} bg={T.redDim} />}
          </PPSection>
          <PPSection title="CONDITIONS" icon={<Heart size={11} />} color={T.amber}>
            {!(v.conditions?.length) ? <NoRecord /> : <TagRow items={v.conditions} color={T.amber} bg={T.amberDim} />}
          </PPSection>
          <div style={{ gridColumn: 'span 2' }}>
            <PPSection title="CURRENT MEDICATIONS" icon={<Pill size={11} />} color={T.blue}>
              {!(v.medications?.length) ? <NoRecord />
                : <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {v.medications.map(m => (
                      <div key={m.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.bg3, borderRadius: 8, padding: '7px 12px' }}>
                        <span style={{ fontSize: 12, color: T.text1 }}>{m.name}</span>
                        <span style={{ fontSize: 10, color: T.blue, background: T.blueDim, borderRadius: 5, padding: '2px 8px' }}>{m.dose}</span>
                      </div>
                    ))}
                  </div>
              }
            </PPSection>
          </div>
          <PPSection title="PRIMARY DOCTOR" icon={<User size={11} />} color={T.teal}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: T.text1 }}>{v.doctor_name || 'Not specified'}</p>
            {v.hospital && <p style={{ margin: '3px 0 0', fontSize: 11, color: T.text2 }}>{v.hospital}</p>}
          </PPSection>
          <PPSection title="EMERGENCY CONTACT" icon={<Phone size={11} />} color={T.green}>
            {(v.contacts || []).map(c => (
              <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: T.text1 }}>{c.name}</p>
                  <p style={{ margin: 0, fontSize: 10, color: T.text2 }}>{c.rel}</p>
                </div>
                <a href={`tel:${c.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 4, background: T.greenDim, border: `1px solid ${T.green}33`, borderRadius: 7, padding: '4px 9px', color: T.green, fontSize: 10, textDecoration: 'none' }}>
                  <Phone size={10} /> {c.phone}
                </a>
              </div>
            ))}
          </PPSection>
          <div style={{ gridColumn: 'span 2' }}>
            <PPSection title="INCIDENT LOCATION" icon={<MapPin size={11} />} color={T.purple}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: T.text1 }}>
                  {parseFloat(e.latitude).toFixed(6)}, {parseFloat(e.longitude).toFixed(6)}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, color: T.blue, background: T.blueDim, borderRadius: 4, padding: '2px 8px', fontFamily: T.font, fontWeight: 700 }}>LIVE UPDATING</span>
                  <span style={{ fontSize: 10, color: T.text2, background: T.bg2, borderRadius: 5, padding: '3px 8px' }}>{new Date(e.created_at).toLocaleTimeString()}</span>
                </div>
              </div>
            </PPSection>
          </div>
        </div>
      )}
    </div>
  );
}

function PPSection({ title, icon, color, children }) {
  return (
    <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color, marginBottom: 10 }}>
        {icon}<span style={{ fontSize: 9, fontFamily: T.font, fontWeight: 700, letterSpacing: 1.5 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function TagRow({ items, color, bg }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {items.map(item => (
        <span key={item} style={{ background: bg, color, border: `1px solid ${color}33`, borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 500 }}>{item}</span>
      ))}
    </div>
  );
}

function NoRecord() {
  return <span style={{ fontSize: 11, color: T.text3 }}>None on record</span>;
}

function EmptyPassport() {
  return (
    <div style={{ height: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 14 }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: T.bg1, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FileText size={26} color={T.text3} />
      </div>
      <div>
        <p style={{ fontFamily: T.font, fontWeight: 700, fontSize: 17, color: T.text1, margin: '0 0 8px' }}>Medical Passport Viewer</p>
        <p style={{ fontSize: 13, color: T.text2, margin: 0, lineHeight: 1.7, maxWidth: 320 }}>Select an incident from the queue to view the patient's full medical passport.</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.text3 }}>
        <Shield size={12} /><span style={{ fontSize: 11 }}>Data shared automatically at time of SOS</span>
      </div>
    </div>
  );
}
