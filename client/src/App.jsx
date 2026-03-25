import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, X, Ambulance, Flame, Car, ShieldAlert, Video, Share2, Clock, Heart, Shield, Lock, Plus, Trash2, CheckCircle, Navigation } from 'lucide-react';
import { io } from 'socket.io-client';
import Dispatcher from './Dispatcher';
import Responder from './Responder';
import HospitalDashboard from './HospitalDashboard';
import MedicalVaultSetup, { loadVault } from './MedicalVaultSetup';
import { useAuth } from './AuthContext';
import LoginScreen from './LoginScreen';
import DoctorConnect from './DoctorConnect';

// ── Fonts injected once ──────────────────────────────────────────────────────
const fontLink = document.createElement('link');
fontLink.rel = 'stylesheet';
fontLink.href = 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,400&display=swap';
document.head.appendChild(fontLink);

// ── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg0:    '#080808',
  bg1:    '#111111',
  bg2:    '#1a1a1a',
  bg3:    '#222222',
  border: '#242424',
  text1:  '#e8e8e8',
  text2:  '#888888',
  text3:  '#444444',
  red:    '#ef4444',
  redDim: '#7f1d1d',
  green:  '#22c55e',
  greenDim:'#166534',
  blue:   '#3b82f6',
  blueDim:'#1e3a5f',
  amber:  '#f59e0b',
  font:   "'Syne', sans-serif",
  body:   "'DM Sans', sans-serif",
};

// ── Global keyframes (injected once) ────────────────────────────────────────
if (!document.getElementById('lb-keyframes')) {
  const style = document.createElement('style');
  style.id = 'lb-keyframes';
  style.textContent = `
    @keyframes lb-pulse  { 0%,100%{opacity:1} 50%{opacity:.4} }
    @keyframes lb-ring   { 0%,100%{transform:scale(1);opacity:.6} 50%{transform:scale(1.08);opacity:.2} }
    @keyframes lb-ring2  { 0%,100%{transform:scale(1);opacity:.3} 50%{transform:scale(1.14);opacity:.08} }
    @keyframes lb-glow   { 0%,100%{box-shadow:0 0 60px 20px rgba(239,68,68,.18)} 50%{box-shadow:0 0 80px 30px rgba(239,68,68,.28)} }
    @keyframes lb-ambmov { 0%{left:15%;top:28%} 100%{left:30%;top:42%} }
    @keyframes lb-etabar { 0%{width:28%} 100%{width:88%} }
    @keyframes lb-fadein { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
    @keyframes lb-dotpulse{ 0%,100%{transform:scale(1)} 50%{transform:scale(1.25)} }
    @keyframes lb-spin   { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
    @keyframes lb-wave   { 0%,100%{height:3px} 50%{height:14px} }
  `;
  document.head.appendChild(style);
}

// ── Utility ──────────────────────────────────────────────────────────────────
const s = (obj) => obj; // passthrough — just for readability of inline style objects

// ── useVoiceSOS hook ──────────────────────────────────────────────────────────
// Continuously listens for the trigger phrase "help help".
// Returns: { listening, transcript, supported, toggle }
function useVoiceSOS({ onTrigger }) {
  const [listening,   setListening]   = useState(false);
  const [transcript,  setTranscript]  = useState('');
  const [supported,   setSupported]   = useState(true);
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    const r = new SpeechRecognition();
    r.continuous    = true;   // keep listening, don't stop after one phrase
    r.interimResults = true;  // show partial results in real time
    r.lang          = 'en-US';
    recognitionRef.current = r;

    r.onresult = (e) => {
      // Collect all interim + final results from this session
      let full = '';
      for (let i = 0; i < e.results.length; i++) {
        full += e.results[i][0].transcript;
      }
      setTranscript(full);

      // Trigger check — case insensitive, allows "help help", "help, help", etc.
      if (/help[\s,!]*help/i.test(full)) {
        r.stop();
        setListening(false);
        setTranscript('');
        onTrigger();   // ← fires setStep(2) in parent
      }
    };

    r.onerror = (e) => {
      // 'not-allowed' = mic permission denied; 'no-speech' = silence timeout
      if (e.error !== 'no-speech') setListening(false);
    };

    r.onend = () => {
      // Auto-restart if still supposed to be listening (handles browser auto-stop)
      if (recognitionRef.current?._shouldListen) {
        try { r.start(); } catch (_) {}
      } else {
        setListening(false);
      }
    };

    return () => {
      recognitionRef.current._shouldListen = false;
      r.abort();
    };
  }, [onTrigger]);

  const toggle = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    if (listening) {
      r._shouldListen = false;
      r.abort();
      setListening(false);
      setTranscript('');
    } else {
      r._shouldListen = true;
      try { r.start(); } catch (_) {}
      setListening(true);
      setTranscript('');
    }
  }, [listening]);

  return { listening, transcript, supported, toggle };
}

// ── Socket singleton ──────────────────────────────────────────────────────────
// One shared socket for the whole app — created once, reused everywhere.
let _socket = null;
function getSocket() {
  if (!_socket) {
    _socket = io('http://localhost:8000', { autoConnect: true });
  }
  return _socket;
}

// ── useLiveLocation hook ──────────────────────────────────────────────────────
// Watches GPS position and emits location_update to the server via socket.
// The server re-broadcasts to all dispatchers so the victim's marker moves live.
// Returns: { sharing, coords, accuracy, toggle }
function useLiveLocation(emergencyId) {
  const [sharing,  setSharing]  = useState(false);
  const [coords,   setCoords]   = useState(null);  // { lat, lng }
  const [accuracy, setAccuracy] = useState(null);
  const watchIdRef = useRef(null);

  const startSharing = useCallback(() => {
    if (!navigator.geolocation) return;
    const socket = getSocket();

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
        setCoords({ lat, lng });
        setAccuracy(Math.round(acc));

        // Emit to server — server re-broadcasts as 'victim_location_update'
        socket.emit('location_update', {
          user_id:      1,
          emergency_id: emergencyId,
          latitude:     lat,
          longitude:    lng,
          accuracy:     acc,
        });
      },
      (err) => console.error('Geolocation error:', err),
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
    setSharing(true);
  }, [emergencyId]);

  const stopSharing = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setSharing(false);
  }, []);

  const toggle = useCallback(() => {
    sharing ? stopSharing() : startSharing();
  }, [sharing, startSharing, stopSharing]);

  // Cleanup on unmount
  useEffect(() => () => stopSharing(), [stopSharing]);

  return { sharing, coords, accuracy, toggle };
}

// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const { user, authFetch, logout }           = useAuth();
  const [appView, setAppView]                 = useState('victim');
  const [step, setStep]                       = useState(1);
  const [isDispatching, setIsDispatching]     = useState(false);
  const [severity, setSeverity]               = useState('');
  const [sosError, setSosError]               = useState('');   // shown in UI, not alert()
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [emergencyId, setEmergencyId]         = useState(null);
  const [showVault, setShowVault]             = useState(false);
  const [showDoctorCall, setShowDoctorCall]   = useState(false);
  const [vaultReady, setVaultReady]           = useState(() => loadVault() !== null);

  const reset = () => {
    setStep(1); setSeverity(''); setSosError('');
    setSelectedCategory(null); setEmergencyId(null);
    setShowVault(false); setShowDoctorCall(false);
  };

  // ── triggerSOS — crash-proof rewrite ────────────────────────────────────
  const triggerSOS = useCallback(async (breathingStatus) => {
    setSosError('');
    setIsDispatching(true);

    // Safe server call — never throws, never uses alert()
    const callServer = async (lat, lng) => {
      try {
        const response = await authFetch('http://localhost:8000/api/sos', {
          method: 'POST',
          body: JSON.stringify({
            latitude:      lat,
            longitude:     lng,
            blood_loss:    'Moderate',
            consciousness: 'Awake',
            breathing:     breathingStatus,
          }),
        });

        // Safely parse JSON — server might return HTML on 500
        let data = {};
        try { data = await response.json(); } catch (_) {}

        if (response.ok) {
          setSeverity(data?.emergency?.severity_score || data?.severity_score || 'Unknown');
          setEmergencyId(data?.emergency?.id || null);
          setStep(3);
        } else {
          setSosError(data?.error || `Server error ${response.status}`);
        }
      } catch (err) {
        // Network down — still advance to step 3 in demo mode
        console.error('SOS network error:', err);
        setSeverity('Unknown');
        setEmergencyId(null);
        setStep(3);
      } finally {
        setIsDispatching(false);
      }
    };

    // GPS with 5s timeout then fallback
    if (!navigator.geolocation) {
      await callServer(12.8231, 80.0442); // fallback coords
      return;
    }

    let done = false;
    const fallbackTimer = setTimeout(async () => {
      if (!done) { done = true; await callServer(12.8231, 80.0442); }
    }, 5000);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!done) {
          done = true;
          clearTimeout(fallbackTimer);
          await callServer(pos.coords.latitude, pos.coords.longitude);
        }
      },
      async () => {
        if (!done) {
          done = true;
          clearTimeout(fallbackTimer);
          await callServer(12.8231, 80.0442);
        }
      },
      { enableHighAccuracy: false, timeout: 4500, maximumAge: 10000 }
    );
  }, [authFetch]);

  return (
    <>
      {/* ── View switcher (only shown when logged in) ── */}
      {user && (
        <div style={{
          position: 'fixed', top: 12, right: 12, zIndex: 9999,
          display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end',
        }}>
          {[
            { id: 'victim',     label: 'Victim Phone' },
            { id: 'dispatcher', label: 'Dispatcher' },
            { id: 'responder',  label: 'Responder' },
            { id: 'hospital',   label: 'Hospital' },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setAppView(id)} style={{
              padding: '7px 14px',
              background: appView === id ? T.red : T.bg2,
              color: appView === id ? '#fff' : T.text2,
              border: `1px solid ${appView === id ? T.red : T.border}`,
              borderRadius: 8,
              fontFamily: T.font, fontWeight: 700, fontSize: 10,
              letterSpacing: '1.5px', textTransform: 'uppercase',
              cursor: 'pointer', transition: 'all .15s',
            }}>
              {label}
            </button>
          ))}
          <button onClick={logout} style={{
            padding: '7px 14px',
            background: T.bg2, color: T.text3,
            border: `1px solid ${T.border}`,
            borderRadius: 8, fontFamily: T.font, fontWeight: 700,
            fontSize: 10, letterSpacing: '1.5px', cursor: 'pointer',
          }}>
            LOGOUT
          </button>
        </div>
      )}

      {appView === 'victim'     && <VictimApp step={step} setStep={setStep} isDispatching={isDispatching}
          severity={severity} selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          triggerSOS={triggerSOS} reset={reset}
          emergencyId={emergencyId} sosError={sosError}
          showVault={showVault} setShowVault={setShowVault}
          vaultReady={vaultReady} setVaultReady={setVaultReady}
          showDoctorCall={showDoctorCall} setShowDoctorCall={setShowDoctorCall} />}
      {appView === 'dispatcher' && <Dispatcher />}
      {appView === 'responder'  && <Responder />}
      {appView === 'hospital'   && <HospitalDashboard />}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function VictimApp({ step, setStep, isDispatching, severity, selectedCategory, setSelectedCategory, triggerSOS, reset, emergencyId, sosError, showVault, setShowVault, vaultReady, setVaultReady, showDoctorCall, setShowDoctorCall }) {
  const { user } = useAuth();

  return (
    <div style={{
      minHeight: '100vh', width: '100vw',
      background: '#050505',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: T.body,
    }}>
      <PhoneFrame>
        <StatusBar />

        {/* Not logged in → show login/register */}
        {!user
          ? <LoginScreen />

          /* Vault setup on first launch */
          : !vaultReady
            ? <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <MedicalVaultSetup onComplete={() => setVaultReady(true)} />
                <div style={{ padding: '12px 18px 20px', flexShrink: 0, borderTop: `1px solid ${T.border}` }}>
                  <button
                    onClick={() => setVaultReady(true)}
                    style={{
                      width: '100%', padding: '11px 0',
                      background: 'transparent', border: `1px solid ${T.border}`,
                      borderRadius: 12, color: T.text3,
                      fontFamily: T.body, fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    Skip for now — fill later
                  </button>
                </div>
              </div>

            /* Medical Vault overlay */
            : showVault
              ? <MedicalVault onClose={() => setShowVault(false)} />

              /* Main SOS flow */
              : <>
                  {step === 1 && <StepHome onActivate={() => setStep(2)} onVault={() => setShowVault(true)} />}
                  {step === 2 && <StepAssess isDispatching={isDispatching} selectedCategory={selectedCategory}
                                    setSelectedCategory={setSelectedCategory}
                                    onCancel={() => setStep(1)} triggerSOS={triggerSOS}
                                    sosError={sosError} />}
                  {step === 3 && <StepConfirmed severity={severity} onReset={reset}
                                    emergencyId={emergencyId} onVault={() => setShowVault(true)}
                                    onDoctorCall={() => setShowDoctorCall(true)} />}
                </>
        }
      </PhoneFrame>

      {/* WebRTC doctor call — full screen overlay */}
      {showDoctorCall && emergencyId && (
        <DoctorConnect
          emergencyId={emergencyId}
          role="victim"
          onClose={() => setShowDoctorCall(false)}
        />
      )}
    </div>
  );
}

// ── Phone shell ──────────────────────────────────────────────────────────────
function PhoneFrame({ children }) {
  return (
    <div style={{
      width: 390, height: 844,
      background: T.bg1,
      borderRadius: 48,
      border: `1.5px solid #1f1f1f`,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      color: T.text1,
      position: 'relative',
      boxShadow: '0 40px 120px rgba(0,0,0,.8)',
    }}>
      {/* Dynamic island */}
      <div style={{
        position: 'absolute', top: 0, left: '50%',
        transform: 'translateX(-50%)',
        width: 120, height: 34,
        background: '#000',
        borderRadius: '0 0 22px 22px',
        zIndex: 20,
      }} />
      {children}
    </div>
  );
}

// ── Status bar ───────────────────────────────────────────────────────────────
function StatusBar() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '14px 24px 4px',
      fontSize: 11, color: T.text3, flexShrink: 0,
      fontFamily: T.body,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: T.green, fontWeight: 500 }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: T.green,
          animation: 'lb-pulse 2s infinite',
          display: 'inline-block',
        }} />
        GPS · 5m
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        45%
        <span style={{
          width: 22, height: 11, border: `1.5px solid #444`, borderRadius: 3,
          display: 'inline-flex', alignItems: 'center', padding: '1px 2px',
          position: 'relative',
        }}>
          <span style={{ width: '45%', height: '100%', background: T.amber, borderRadius: 1 }} />
          <span style={{
            position: 'absolute', right: -4, top: '50%', transform: 'translateY(-50%)',
            width: 3, height: 5, background: '#444', borderRadius: '0 1px 1px 0',
          }} />
        </span>
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 1 — SOS Home
// ════════════════════════════════════════════════════════════════════════════
function StepHome({ onActivate, onVault }) {
  const { listening, transcript, supported, toggle } = useVoiceSOS({ onTrigger: onActivate });

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 24px 32px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* App wordmark */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginTop: 4 }}>
        <span style={{ fontFamily: T.font, fontWeight: 800, fontSize: 13, letterSpacing: 4, color: T.text3, textTransform: 'uppercase' }}>
          LiveBridge
        </span>
        <span style={{ fontSize: 10, color: T.text3, letterSpacing: 2 }}>EMERGENCY RESPONSE</span>
      </div>

      {/* SOS button + rings */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        {/* Outer ambient ring */}
        <div style={{
          position: 'absolute',
          width: 300, height: 300, borderRadius: '50%',
          border: `1px solid rgba(239,68,68,.12)`,
          animation: 'lb-ring2 3.5s ease-in-out infinite',
        }} />
        {/* Mid ring */}
        <div style={{
          position: 'absolute',
          width: 260, height: 260, borderRadius: '50%',
          border: `1px solid rgba(239,68,68,.2)`,
          animation: 'lb-ring 3s ease-in-out infinite',
        }} />

        <button
          onClick={onActivate}
          style={{
            width: 210, height: 210, borderRadius: '50%',
            background: `radial-gradient(circle at 40% 35%, #f87171, #ef4444 55%, #b91c1c)`,
            border: 'none',
            color: '#fff',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            animation: 'lb-glow 3s ease-in-out infinite',
            transition: 'transform .1s',
            position: 'relative', zIndex: 2,
          }}
          onMouseDown={e => e.currentTarget.style.transform = 'scale(.96)'}
          onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          onTouchStart={e => e.currentTarget.style.transform = 'scale(.96)'}
          onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          {/* Inner highlight */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'linear-gradient(160deg, rgba(255,255,255,.12) 0%, transparent 55%)',
            pointerEvents: 'none',
          }} />
          <span style={{ fontFamily: T.font, fontSize: 40, fontWeight: 800, letterSpacing: 4, lineHeight: 1 }}>SOS</span>
          <span style={{ fontSize: 9, opacity: .8, letterSpacing: 2, marginTop: 6, textAlign: 'center', lineHeight: 1.7 }}>
            TAP OR HOLD<br />FOR EMERGENCY
          </span>
        </button>
      </div>

      {/* Quick stats row */}
      <div style={{ display: 'flex', gap: 10, width: '100%', marginBottom: 14 }}>
        {[
          { icon: <Heart size={13} />,  label: 'Health Data', val: 'Synced' },
          { icon: <Clock size={13} />,  label: 'Avg Response', val: '4 min' },
          { icon: <Shield size={13} />, label: 'Contacts', val: '3 Active' },
        ].map(({ icon, label, val }) => (
          <div key={label} style={{
            flex: 1, background: T.bg2, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: '10px 8px', textAlign: 'center',
          }}>
            <div style={{ color: T.text3, marginBottom: 4, display: 'flex', justifyContent: 'center' }}>{icon}</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: T.text1 }}>{val}</div>
            <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{label}</div>
          </div>
        ))}
        {/* Medical Vault shortcut */}
        <div onClick={onVault} style={{
          flex: 1, background: '#0d1224', border: `1px solid #1a2540`,
          borderRadius: 12, padding: '10px 8px', textAlign: 'center', cursor: 'pointer',
        }}>
          <div style={{ color: T.blue, marginBottom: 4, display: 'flex', justifyContent: 'center' }}>
            <Lock size={13} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#60a5fa' }}>Vault</div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>Medical</div>
        </div>
      </div>

      {/* Voice bar — interactive */}
      <button
        onClick={supported ? toggle : undefined}
        disabled={!supported}
        style={{
          background: listening ? '#0d1a0d' : T.bg2,
          border: `1px solid ${listening ? T.green : T.border}`,
          borderRadius: 16, padding: '14px 18px',
          display: 'flex', alignItems: 'center', gap: 14, width: '100%',
          cursor: supported ? 'pointer' : 'default',
          transition: 'all .2s', textAlign: 'left',
        }}
      >
        {/* Mic icon — glows green while listening */}
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: listening ? '#166534' : T.bg3,
          border: `1px solid ${listening ? T.green : T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          transition: 'all .2s',
          animation: listening ? 'lb-pulse 1.5s infinite' : 'none',
        }}>
          <Mic size={16} color={listening ? T.green : T.text3} />
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 500, fontSize: 13, color: listening ? '#4ade80' : T.text1 }}>
            {!supported
              ? 'Voice SOS unavailable'
              : listening
                ? 'Listening... say "Help Help"'
                : 'Voice-Activated SOS'}
          </p>
          {/* Live transcript shown while listening */}
          <p style={{
            margin: '3px 0 0', fontSize: 11,
            color: listening ? T.green : T.text3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {listening && transcript
              ? `"${transcript}"`
              : listening
                ? 'Tap to stop · browser mic active'
                : 'Tap to start · say "Help Help"'}
          </p>
        </div>

        {/* Waveform bars — animate when listening, static when not */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 18, flexShrink: 0 }}>
          {[0,1,2,3,4].map((i) => (
            <div key={i} style={{
              width: 3, borderRadius: 2,
              background: listening ? T.green : T.text3,
              opacity: listening ? 0.9 : 0.4,
              height: listening ? 3 : [3,5,7,5,3][i],
              animation: listening
                ? `lb-wave ${0.6 + i * 0.12}s ease-in-out ${i * 0.1}s infinite`
                : 'none',
              transition: 'background .2s, opacity .2s',
            }} />
          ))}
        </div>
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 2 — Assessment
// ════════════════════════════════════════════════════════════════════════════
function StepAssess({ isDispatching, selectedCategory, setSelectedCategory, onCancel, triggerSOS, sosError }) {
  const categories = [
    { id: 'Medical',  icon: <Ambulance size={26} />,   color: T.blue },
    { id: 'Fire',     icon: <Flame size={26} />,        color: '#f97316' },
    { id: 'Crash',    icon: <Car size={26} />,           color: T.amber },
    { id: 'Assault',  icon: <ShieldAlert size={26} />,  color: T.red },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'lb-fadein .25s ease' }}>
      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, #b91c1c, #ef4444)`,
        padding: '18px 20px 16px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontFamily: T.font, fontWeight: 700, fontSize: 17, color: '#fff', margin: 0 }}>Emergency Activated</h2>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: 'rgba(255,255,255,.7)' }}>
              {isDispatching ? 'Acquiring GPS & triaging...' : 'Dispatching help...'}
            </p>
          </div>
          {/* Animated SOS badge */}
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(0,0,0,.2)', border: '1.5px solid rgba(255,255,255,.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {isDispatching
              ? <div style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'lb-spin .8s linear infinite' }} />
              : <span style={{ fontFamily: T.font, fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: 1 }}>SOS</span>}
          </div>
        </div>

        <button
          onClick={onCancel}
          disabled={isDispatching}
          style={{
            marginTop: 12,
            background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.2)',
            borderRadius: 20, color: '#fff', fontSize: 12,
            padding: '7px 16px',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            cursor: isDispatching ? 'not-allowed' : 'pointer',
            opacity: isDispatching ? .5 : 1,
            fontFamily: T.body,
          }}
        >
          <X size={12} /> TAP TO CANCEL SOS
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* Error display — replaces alert() */}
        {sosError && (
          <div style={{
            background: '#1a0d0d', border: `1px solid ${T.red}44`,
            borderRadius: 10, padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
            <span style={{ fontSize: 12, color: '#f87171', fontFamily: T.body, lineHeight: 1.5 }}>
              {sosError}
            </span>
          </div>
        )}

        {/* Emergency type */}
        <div>
          <SectionLabel>Emergency Type</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {categories.map(({ id, icon, color }) => {
              const sel = selectedCategory === id;
              return (
                <button key={id} onClick={() => setSelectedCategory(id)} style={{
                  background: sel ? `${color}18` : T.bg2,
                  border: `1.5px solid ${sel ? color : T.border}`,
                  borderRadius: 14, padding: '18px 10px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  color: sel ? color : T.text3,
                  cursor: 'pointer', transition: 'all .15s',
                  fontFamily: T.body, fontSize: 12, fontWeight: 500,
                }}>
                  <span style={{ color: sel ? color : T.text3, display: 'flex' }}>{icon}</span>
                  {id}
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick assessment */}
        <div>
          <SectionLabel>Quick Assessment</SectionLabel>
          <div style={{
            background: T.bg2, border: `1px solid ${T.border}`,
            borderRadius: 14, padding: 16,
          }}>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: T.text1, fontWeight: 500, lineHeight: 1.5 }}>
              Are you breathing normally?
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: 'YES',        val: 'Normal',  bg: '#166534', col: '#4ade80' },
                { label: 'NO',         val: 'Labored', bg: '#7f1d1d', col: '#f87171' },
                { label: "DON'T KNOW", val: 'Normal',  bg: '#78350f', col: '#fbbf24' },
              ].map(({ label, val, bg, col }) => (
                <button key={label} onClick={() => triggerSOS(val)} disabled={isDispatching} style={{
                  flex: 1, padding: '12px 4px',
                  background: bg, color: col,
                  border: 'none', borderRadius: 10,
                  fontFamily: T.font, fontWeight: 700, fontSize: 10, letterSpacing: 1,
                  cursor: isDispatching ? 'not-allowed' : 'pointer',
                  opacity: isDispatching ? .5 : 1,
                  transition: 'opacity .15s',
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tip */}
        <div style={{
          background: '#0d1a0d', border: `1px solid #1a2d1a`,
          borderRadius: 12, padding: '12px 14px',
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <div style={{ color: T.green, flexShrink: 0, marginTop: 1 }}><Shield size={14} /></div>
          <p style={{ margin: 0, fontSize: 12, color: '#4ade80', lineHeight: 1.6 }}>
            Your medical data and live location will be shared with the responding paramedic unit.
          </p>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 3 — Confirmed
// ════════════════════════════════════════════════════════════════════════════
function StepConfirmed({ severity, onReset, emergencyId, onVault, onDoctorCall }) {
  const sevColor = severity === 'Critical' ? T.red : severity === 'High' ? T.amber : T.green;
  const { sharing, coords, accuracy, toggle: toggleLocation } = useLiveLocation(emergencyId);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'lb-fadein .3s ease' }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, #14532d, #166534)`, padding: '18px 20px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'rgba(255,255,255,.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 16 }}>✓</span>
          </div>
          <div>
            <h2 style={{ fontFamily: T.font, fontWeight: 700, fontSize: 16, color: '#fff', margin: 0 }}>Help is on the way!</h2>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(255,255,255,.7)' }}>SMS sent to 3 emergency contacts</p>
          </div>
        </div>
      </div>

      {/* Mini map */}
      <div style={{ height: 160, background: '#0a1410', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        {/* Grid */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(34,197,94,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,.05) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }} />
        {/* Road lines */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 390 160">
          <line x1="0" y1="80" x2="390" y2="80" stroke="rgba(34,197,94,.07)" strokeWidth="14" />
          <line x1="195" y1="0" x2="195" y2="160" stroke="rgba(34,197,94,.07)" strokeWidth="14" />
          <line x1="0" y1="130" x2="390" y2="40" stroke="rgba(34,197,94,.04)" strokeWidth="8" />
        </svg>
        {/* Ambulance marker */}
        <div style={{
          position: 'absolute', top: '28%', left: '16%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          animation: 'lb-ambmov 5s ease-in-out infinite alternate',
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: 8,
            background: T.blue,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Ambulance size={14} color="#fff" />
          </div>
          <span style={{ fontSize: 9, color: '#60a5fa', fontWeight: 700, letterSpacing: .5 }}>UP-14</span>
        </div>
        {/* You marker */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'rgba(239,68,68,.14)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'lb-dotpulse 2s ease-in-out infinite',
          }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              background: T.red, border: '2.5px solid #fff',
            }} />
          </div>
          <span style={{ fontSize: 9, color: T.red, fontWeight: 700, letterSpacing: 1 }}>YOU</span>
        </div>
        {/* Dashed route line */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} viewBox="0 0 390 160">
          <line x1="80" y1="75" x2="195" y2="80" stroke={T.blue} strokeWidth="1.5" strokeDasharray="5,4" opacity=".4" />
        </svg>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Dispatch card */}
        <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 11,
              background: T.blueDim,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Ambulance size={20} color="#60a5fa" />
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 500, fontSize: 14, color: T.text1 }}>Ambulance UP-14 Dispatched</p>
              <span style={{ fontSize: 11, color: T.text3 }}>Advanced Life Support Unit</span>
            </div>
          </div>

          {/* Triage pill */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: `${sevColor}14`,
            border: `1px solid ${sevColor}33`,
            borderRadius: 8, padding: '5px 12px', marginBottom: 12,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: sevColor }} />
            <span style={{ fontSize: 11, color: T.text3 }}>AI Triage Level:</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: sevColor, fontFamily: T.font, letterSpacing: 1 }}>
              {severity ? severity.toUpperCase() : 'ANALYZING...'}
            </span>
          </div>

          {/* ETA */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <Clock size={14} color={T.amber} />
            <span style={{ fontFamily: T.font, fontWeight: 700, fontSize: 24, color: T.amber }}>4 min</span>
            <span style={{ fontSize: 11, color: T.text3 }}>estimated arrival</span>
          </div>
          <div style={{ height: 3, background: T.bg3, borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '30%', background: T.amber, borderRadius: 2, animation: 'lb-etabar 4s linear infinite' }} />
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: T.text3 }}>Paramedics have access to your medical information</p>
        </div>

        {/* While you wait */}
        <div style={{
          background: '#0d1a0d', border: `1px solid #1a2d1a`,
          borderRadius: 14, padding: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Clock size={13} color={T.green} />
            <span style={{ fontSize: 12, fontWeight: 500, color: '#4ade80' }}>While you wait</span>
          </div>
          {[
            'Stay calm and try to remain still',
            'Keep your phone close and charged',
            'Unlock your door if safe to do so',
            'Turn on outdoor lights if it\'s dark',
          ].map(tip => (
            <div key={tip} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: T.green, marginTop: 6, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: T.text2, lineHeight: 1.5 }}>{tip}</span>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <button onClick={onDoctorCall} style={{
          width: '100%', padding: 14,
          background: T.blueDim, border: `1px solid #2a4f7f`,
          borderRadius: 12, color: '#60a5fa',
          fontFamily: T.font, fontWeight: 700, fontSize: 13, letterSpacing: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          cursor: 'pointer',
        }}>
          <Video size={16} /> CONNECT TO DOCTOR NOW
        </button>

        {/* Share Live Location — wired to useLiveLocation */}
        <button onClick={toggleLocation} style={{
          width: '100%', padding: 14,
          background: sharing ? '#0d1a0d' : 'transparent',
          border: `1px solid ${sharing ? T.green : T.border}`,
          borderRadius: 12,
          color: sharing ? '#4ade80' : T.text3,
          fontFamily: T.font, fontWeight: 700, fontSize: 13, letterSpacing: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          cursor: 'pointer', transition: 'all .2s',
        }}>
          <Navigation size={16} style={{ animation: sharing ? 'lb-pulse 1.5s infinite' : 'none' }} />
          {sharing ? 'SHARING LIVE LOCATION' : 'SHARE LIVE LOCATION'}
          {sharing && coords && (
            <span style={{ fontSize: 10, opacity: .7, fontFamily: T.body, fontWeight: 400, letterSpacing: 0 }}>
              ±{accuracy}m
            </span>
          )}
        </button>

        {/* Live coords feedback when sharing */}
        {sharing && coords && (
          <div style={{
            background: '#0a1410', border: `1px solid #1a2d1a`,
            borderRadius: 10, padding: '8px 12px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.green, animation: 'lb-pulse 1.5s infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#4ade80', fontFamily: T.body }}>
              Dispatcher receiving your location live
            </span>
            <span style={{ fontSize: 10, color: T.text3, marginLeft: 'auto' }}>
              {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
            </span>
          </div>
        )}

        {/* Medical Vault button */}
        <button onClick={onVault} style={{
          width: '100%', padding: 14,
          background: '#0d1224', border: `1px solid #1a2540`,
          borderRadius: 12, color: '#60a5fa',
          fontFamily: T.font, fontWeight: 700, fontSize: 13, letterSpacing: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          cursor: 'pointer',
        }}>
          <Lock size={16} /> VIEW MEDICAL VAULT
        </button>

        <button onClick={onReset} style={{
          background: 'none', border: 'none',
          color: T.text3, fontSize: 11,
          textDecoration: 'underline', cursor: 'pointer',
          padding: '8px 0', width: '100%',
          fontFamily: T.body,
        }}>
          Reset Prototype
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MEDICAL VAULT
// ════════════════════════════════════════════════════════════════════════════
const DEFAULT_VAULT_DISPLAY = {
  bloodType:  'A+',
  allergies:  ['Penicillin', 'Sulfa drugs'],
  conditions: ['Type 2 Diabetes', 'Hypertension'],
  medications:[{ name: 'Metformin', dose: '500mg twice daily' }, { name: 'Lisinopril', dose: '10mg once daily' }],
  contacts:   [
    { name: 'Priya Shaw',  rel: 'Mother',  phone: '+91 98765 43210' },
    { name: 'Arjun Shaw',  rel: 'Brother', phone: '+91 87654 32109' },
  ],
  doctorName: 'Dr. Kavitha Rajan',
  hospital:   'Apollo Hospitals, Chennai',
};

function loadDisplayVault() {
  try {
    const raw = localStorage.getItem('lb_medical_vault');
    return raw ? JSON.parse(raw) : DEFAULT_VAULT_DISPLAY;
  } catch { return DEFAULT_VAULT_DISPLAY; }
}
function saveDisplayVault(v) {
  try { localStorage.setItem('lb_medical_vault', JSON.stringify(v)); } catch {}
}

function MedicalVault({ onClose }) {
  const [vault, setVaultState] = useState(loadDisplayVault);
  const [editing, setEditing]  = useState(false);
  const [draft,   setDraft]    = useState(null);

  const startEdit  = () => { setDraft(JSON.parse(JSON.stringify(vault))); setEditing(true); };
  const cancelEdit = () => { setEditing(false); setDraft(null); };
  const saveEdit   = () => {
    saveDisplayVault(draft);
    setVaultState(draft);
    setEditing(false);
    setDraft(null);
  };

  const d = editing ? draft : vault;

  const BLOOD_TYPES = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'lb-fadein .2s ease' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #0d1224, #1a2540)',
        padding: '18px 20px 16px', flexShrink: 0,
        borderBottom: `1px solid #1e2d45`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: '#1a2f5a', border: `1px solid #2a4f8f`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Lock size={16} color="#60a5fa" />
            </div>
            <div>
              <h2 style={{ fontFamily: T.font, fontWeight: 700, fontSize: 15, color: '#fff', margin: 0 }}>Medical Vault</h2>
              <p style={{ margin: 0, fontSize: 10, color: '#4a6fa5' }}>Secure · Shared with paramedics on SOS</p>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,.08)', border: 'none',
            borderRadius: '50%', width: 30, height: 30,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#fff',
          }}>
            <X size={14} />
          </button>
        </div>

        {/* Edit / Save bar */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {editing ? (
            <>
              <button onClick={saveEdit} style={{
                flex: 1, padding: '8px 0', background: '#166534', border: `1px solid ${T.green}`,
                borderRadius: 8, color: '#4ade80', fontFamily: T.font, fontWeight: 700,
                fontSize: 11, letterSpacing: 1, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <CheckCircle size={12} /> SAVE VAULT
              </button>
              <button onClick={cancelEdit} style={{
                flex: 1, padding: '8px 0', background: 'rgba(255,255,255,.08)',
                border: '1px solid rgba(255,255,255,.1)',
                borderRadius: 8, color: 'rgba(255,255,255,.6)', fontFamily: T.font,
                fontWeight: 700, fontSize: 11, letterSpacing: 1, cursor: 'pointer',
              }}>
                CANCEL
              </button>
            </>
          ) : (
            <button onClick={startEdit} style={{
              flex: 1, padding: '8px 0', background: 'rgba(255,255,255,.08)',
              border: '1px solid rgba(255,255,255,.15)', borderRadius: 8,
              color: 'rgba(255,255,255,.7)', fontFamily: T.font, fontWeight: 700,
              fontSize: 11, letterSpacing: 1, cursor: 'pointer',
            }}>
              EDIT MEDICAL DATA
            </button>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Blood type + primary doctor */}
        <div style={{ display: 'flex', gap: 10 }}>
          {/* Blood type */}
          <div style={{
            background: '#1a0d0d', border: `1px solid #3f1010`,
            borderRadius: 14, padding: '14px 12px', flex: 1, textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: T.text3, letterSpacing: 1.5, marginBottom: 6, fontFamily: T.font }}>BLOOD TYPE</div>
            {editing ? (
              <select
                value={d.bloodType}
                onChange={e => setDraft(p => ({ ...p, bloodType: e.target.value }))}
                style={{
                  background: T.bg3, border: `1px solid ${T.border}`, borderRadius: 6,
                  color: T.red, fontFamily: T.font, fontWeight: 800, fontSize: 22,
                  width: '100%', textAlign: 'center', padding: '2px 4px',
                }}
              >
                {BLOOD_TYPES.map(bt => <option key={bt} value={bt}>{bt}</option>)}
              </select>
            ) : (
              <div style={{ fontFamily: T.font, fontWeight: 800, fontSize: 28, color: T.red }}>{d.bloodType}</div>
            )}
          </div>
          {/* Doctor */}
          <div style={{
            background: T.bg2, border: `1px solid ${T.border}`,
            borderRadius: 14, padding: '14px 12px', flex: 2,
          }}>
            <div style={{ fontSize: 10, color: T.text3, letterSpacing: 1.5, marginBottom: 6, fontFamily: T.font }}>PRIMARY DOCTOR</div>
            {editing ? (
              <>
                <input value={d.doctorName} onChange={e => setDraft(p => ({ ...p, doctorName: e.target.value }))}
                  style={inputStyle} placeholder="Doctor name" />
                <input value={d.hospital} onChange={e => setDraft(p => ({ ...p, hospital: e.target.value }))}
                  style={{ ...inputStyle, marginTop: 4, fontSize: 10 }} placeholder="Hospital" />
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.text1 }}>{d.doctorName}</div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{d.hospital}</div>
              </>
            )}
          </div>
        </div>

        {/* Allergies */}
        <VaultSection title="Allergies" color={T.red} bgColor="#1a0d0d" borderColor="#3f1010">
          <TagList
            items={d.allergies}
            editing={editing}
            tagColor={T.red}
            tagBg="#3f1010"
            onAdd={() => setDraft(p => ({ ...p, allergies: [...p.allergies, ''] }))}
            onRemove={i => setDraft(p => ({ ...p, allergies: p.allergies.filter((_,j) => j !== i) }))}
            onChange={(i, v) => setDraft(p => ({ ...p, allergies: p.allergies.map((a, j) => j === i ? v : a) }))}
          />
        </VaultSection>

        {/* Conditions */}
        <VaultSection title="Medical Conditions" color={T.amber} bgColor="#1a0f00" borderColor="#3d2800">
          <TagList
            items={d.conditions}
            editing={editing}
            tagColor={T.amber}
            tagBg="#3d2800"
            onAdd={() => setDraft(p => ({ ...p, conditions: [...p.conditions, ''] }))}
            onRemove={i => setDraft(p => ({ ...p, conditions: p.conditions.filter((_,j) => j !== i) }))}
            onChange={(i, v) => setDraft(p => ({ ...p, conditions: p.conditions.map((a, j) => j === i ? v : a) }))}
          />
        </VaultSection>

        {/* Medications */}
        <VaultSection title="Current Medications" color={T.blue} bgColor="#0d1224" borderColor="#1e2d45">
          {d.medications.map((med, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
            }}>
              <div style={{ flex: 1 }}>
                {editing ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={med.name} onChange={e => setDraft(p => ({
                      ...p, medications: p.medications.map((m, j) => j === i ? { ...m, name: e.target.value } : m)
                    }))} style={{ ...inputStyle, flex: 1 }} placeholder="Drug name" />
                    <input value={med.dose} onChange={e => setDraft(p => ({
                      ...p, medications: p.medications.map((m, j) => j === i ? { ...m, dose: e.target.value } : m)
                    }))} style={{ ...inputStyle, flex: 1 }} placeholder="Dosage" />
                    <button onClick={() => setDraft(p => ({ ...p, medications: p.medications.filter((_,j) => j !== i) }))}
                      style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', padding: 4 }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: T.text1 }}>{med.name}</span>
                    <span style={{ fontSize: 11, color: '#60a5fa', background: '#1a2540', borderRadius: 6, padding: '2px 8px' }}>{med.dose}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {editing && (
            <button onClick={() => setDraft(p => ({ ...p, medications: [...p.medications, { name: '', dose: '' }] }))}
              style={{ ...addBtnStyle, color: '#60a5fa', borderColor: '#1e2d45' }}>
              <Plus size={12} /> Add medication
            </button>
          )}
        </VaultSection>

        {/* Emergency contacts */}
        <VaultSection title="Emergency Contacts" color={T.green} bgColor="#0d1a0d" borderColor="#1a2d1a">
          {d.contacts.map((c, i) => (
            <div key={i} style={{ marginBottom: editing ? 8 : 10 }}>
              {editing ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={c.name} onChange={e => setDraft(p => ({
                    ...p, contacts: p.contacts.map((ct, j) => j === i ? { ...ct, name: e.target.value } : ct)
                  }))} style={{ ...inputStyle, flex: 2 }} placeholder="Name" />
                  <input value={c.rel} onChange={e => setDraft(p => ({
                    ...p, contacts: p.contacts.map((ct, j) => j === i ? { ...ct, rel: e.target.value } : ct)
                  }))} style={{ ...inputStyle, flex: 1 }} placeholder="Relation" />
                  <input value={c.phone} onChange={e => setDraft(p => ({
                    ...p, contacts: p.contacts.map((ct, j) => j === i ? { ...ct, phone: e.target.value } : ct)
                  }))} style={{ ...inputStyle, flex: 2 }} placeholder="Phone" />
                  <button onClick={() => setDraft(p => ({ ...p, contacts: p.contacts.filter((_,j) => j !== i) }))}
                    style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', padding: 4 }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: T.text1 }}>{c.name}</span>
                    <span style={{ fontSize: 11, color: T.text3, marginLeft: 8 }}>{c.rel}</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#4ade80' }}>{c.phone}</span>
                </div>
              )}
            </div>
          ))}
          {editing && (
            <button onClick={() => setDraft(p => ({ ...p, contacts: [...p.contacts, { name: '', rel: '', phone: '' }] }))}
              style={{ ...addBtnStyle, color: '#4ade80', borderColor: '#1a2d1a' }}>
              <Plus size={12} /> Add contact
            </button>
          )}
        </VaultSection>

        {/* Paramedic access note */}
        <div style={{
          background: '#0d1a0d', border: `1px solid #1a2d1a`,
          borderRadius: 12, padding: '12px 14px',
          display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <Shield size={13} color={T.green} style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 11, color: '#4ade80', lineHeight: 1.6 }}>
            This data is automatically shared with the responding paramedic the moment you press SOS — no manual steps needed.
          </p>
        </div>
      </div>
    </div>
  );
}

// Vault sub-components
function VaultSection({ title, color, bgColor, borderColor, children }) {
  return (
    <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 14, padding: 14 }}>
      <div style={{ fontSize: 10, color, letterSpacing: 1.5, marginBottom: 10, fontFamily: T.font, fontWeight: 700 }}>
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

function TagList({ items, editing, tagColor, tagBg, onAdd, onRemove, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((item, i) => (
        editing ? (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input value={item} onChange={e => onChange(i, e.target.value)}
              style={{ ...inputStyle, width: 100 }} />
            <button onClick={() => onRemove(i)}
              style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', padding: 2 }}>
              <Trash2 size={11} />
            </button>
          </div>
        ) : (
          <span key={i} style={{
            background: tagBg, color: tagColor,
            fontSize: 11, fontWeight: 500, borderRadius: 6, padding: '4px 10px',
          }}>{item}</span>
        )
      ))}
      {editing && (
        <button onClick={onAdd} style={{ ...addBtnStyle, color: tagColor, borderColor: tagBg }}>
          <Plus size={11} />
        </button>
      )}
    </div>
  );
}

const inputStyle = {
  background: T.bg3, border: `1px solid ${T.border}`, borderRadius: 6,
  color: T.text1, fontFamily: T.body, fontSize: 12, padding: '5px 8px',
  outline: 'none', width: '100%',
};
const addBtnStyle = {
  background: 'transparent', border: `1px dashed`, borderRadius: 6,
  padding: '4px 10px', cursor: 'pointer', fontFamily: T.body,
  fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
  marginTop: 4,
};

// ── Helper ───────────────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 500, letterSpacing: 2,
      color: T.text3, textTransform: 'uppercase',
      marginBottom: 10, fontFamily: T.font,
    }}>
      {children}
    </div>
  );
}
