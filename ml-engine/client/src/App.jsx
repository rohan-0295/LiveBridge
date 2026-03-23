import { useState } from 'react';
import { Mic, Crosshair, Battery, X, Ambulance, Flame, Car, ShieldAlert, Video, Share2, MapPin } from 'lucide-react';
import Dispatcher from './Dispatcher';

function App() {
  const [appView, setAppView] = useState('victim'); 
  const [step, setStep] = useState(1); 
  const [isDispatching, setIsDispatching] = useState(false); 
  const [severity, setSeverity] = useState(''); 
  const [selectedCategory, setSelectedCategory] = useState(null);

  const triggerSOS = async (breathingStatus) => {
    setIsDispatching(true);
    
    if (!navigator.geolocation) {
      alert("Your browser doesn't support geolocation!");
      setIsDispatching(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const response = await fetch('http://localhost:8000/api/sos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: 1, 
            latitude: position.coords.latitude, 
            longitude: position.coords.longitude, 
            blood_loss: "Low", 
            consciousness: "Awake", 
            breathing: breathingStatus 
          })
        });

        const data = await response.json();
        
        if (response.ok) {
          setSeverity(data.emergency.severity_score); 
          setStep(3); 
        } else {
          alert('❌ Error: Could not reach dispatch.');
        }
      } catch (error) {
        console.error(error);
        alert('❌ Network Error: Are your Node & Python servers running?');
      } finally {
        setIsDispatching(false); 
      }
    }, (error) => {
      alert("⚠️ We need your location to send the SOS!");
      setIsDispatching(false);
    });
  };

  const renderVictimApp = () => {
    if (step === 1) {
      return (
        <MobileFrame>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#9ca3af', fontSize: '0.8rem', marginBottom: 'auto' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Crosshair size={14} color="#22c55e" /> GPS Active</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Battery size={14} /> 45%</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
            <button 
              onClick={() => setStep(2)}
              style={{
                width: '220px', height: '220px', borderRadius: '50%', backgroundColor: '#ef4444',
                border: '8px solid #7f1d1d', color: 'white', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                boxShadow: '0 0 60px 20px rgba(239, 68, 68, 0.3)', transition: 'transform 0.1s'
              }}
            >
              <span style={{ fontSize: '4rem', fontWeight: 'bold', letterSpacing: '2px' }}>SOS</span>
              <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>TAP OR HOLD<br/>FOR EMERGENCY</span>
            </button>
          </div>

          <div style={{ backgroundColor: '#1f2937', padding: '16px', borderRadius: '16px', display: 'flex', alignItems: 'center', gap: '16px', marginTop: 'auto' }}>
            <div style={{ backgroundColor: '#374151', padding: '10px', borderRadius: '50%' }}>
              <Mic size={20} color="#9ca3af" />
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 'bold', fontSize: '0.9rem' }}>Voice-Activated SOS</p>
              <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.8rem' }}>Say "Help Help" to activate</p>
            </div>
          </div>
        </MobileFrame>
      );
    }

    if (step === 2) {
      return (
        <MobileFrame>
          <div style={{ backgroundColor: '#ef4444', margin: '-24px -24px 24px -24px', padding: '24px', textAlign: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>Emergency Activated</h2>
            <p style={{ margin: '4px 0 16px 0', fontSize: '0.8rem', opacity: 0.9 }}>
              {isDispatching ? "Acquiring GPS & Triaging..." : "Dispatching help..."}
            </p>
            <button onClick={() => { setStep(1); setSelectedCategory(null); }} disabled={isDispatching} style={{ backgroundColor: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 auto', cursor: 'pointer', opacity: isDispatching ? 0.5 : 1 }}>
              <X size={16} /> TAP TO CANCEL SOS
            </button>
          </div>

          <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>What type of emergency?</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
            <EmergencyOption icon={Ambulance} label="Medical" isSelected={selectedCategory === 'Medical'} onClick={() => setSelectedCategory('Medical')} />
            <EmergencyOption icon={Flame} label="Fire" isSelected={selectedCategory === 'Fire'} onClick={() => setSelectedCategory('Fire')} />
            <EmergencyOption icon={Car} label="Crash" isSelected={selectedCategory === 'Crash'} onClick={() => setSelectedCategory('Crash')} />
            <EmergencyOption icon={ShieldAlert} label="Assault" isSelected={selectedCategory === 'Assault'} onClick={() => setSelectedCategory('Assault')} />
          </div>

          <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>Quick Assessment</h3>
          <div style={{ backgroundColor: '#1f2937', padding: '16px', borderRadius: '12px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <p style={{ margin: '0 0 auto 0', fontSize: '0.9rem' }}>Are you breathing normally?</p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => triggerSOS("Normal")} disabled={isDispatching} style={{ flex: 1, padding: '12px', backgroundColor: '#22c55e', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', opacity: isDispatching ? 0.5 : 1 }}>YES</button>
              <button onClick={() => triggerSOS("Labored")} disabled={isDispatching} style={{ flex: 1, padding: '12px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', opacity: isDispatching ? 0.5 : 1 }}>NO</button>
              <button onClick={() => triggerSOS("Normal")} disabled={isDispatching} style={{ flex: 1, padding: '12px', backgroundColor: '#f59e0b', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', opacity: isDispatching ? 0.5 : 1 }}>DON'T KNOW</button>
            </div>
          </div>
        </MobileFrame>
      );
    }

    if (step === 3) {
      return (
        <MobileFrame>
          <div style={{ backgroundColor: '#22c55e', margin: '-24px -24px 0 -24px', padding: '24px' }}>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>Help is on the way!</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', opacity: 0.9 }}>SMS sent to 3 emergency contacts</p>
          </div>

          <div style={{ backgroundColor: '#1e293b', margin: '0 -24px', height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #334155' }}>
             <div style={{ textAlign: 'center', color: '#64748b' }}>
               <MapPin size={32} />
               <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem' }}>Live Tracking Active</p>
             </div>
          </div>

          <div style={{ backgroundColor: '#1f2937', margin: '16px 0', padding: '16px', borderRadius: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{ backgroundColor: '#3b82f6', padding: '10px', borderRadius: '50%' }}><Ambulance size={20} /></div>
              <div>
                <p style={{ margin: 0, fontWeight: 'bold' }}>Ambulance UP-14 Dispatched</p>
                <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.8rem' }}>Advanced Life Support Unit</p>
              </div>
            </div>
            
            <div style={{ backgroundColor: '#374151', padding: '8px 12px', borderRadius: '6px', display: 'inline-block', marginBottom: '12px' }}>
              <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>AI Triage Level: </span>
              <span style={{ fontWeight: 'bold', color: severity === 'Critical' ? '#ef4444' : '#f59e0b' }}>
                {severity.toUpperCase()}
              </span>
            </div>

            <h2 style={{ margin: '0 0 8px 0', color: '#f59e0b' }}>⏱ ETA: 4 Minutes</h2>
            <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.8rem' }}>Paramedics have access to your medical information</p>
          </div>

          <button style={{ width: '100%', padding: '14px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '12px', cursor: 'pointer' }}>
            <Video size={18} /> CONNECT TO DOCTOR NOW
          </button>
          
          <button onClick={() => { setStep(1); setSeverity(''); setSelectedCategory(null); }} style={{ marginTop: 'auto', background: 'none', border: 'none', color: '#6b7280', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.8rem', width: '100%', padding: '14px' }}>Reset Prototype</button>
        </MobileFrame>
      );
    }
  };

  return (
    <>
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 9999, display: 'flex', gap: '10px' }}>
        <button onClick={() => setAppView('victim')} style={{ padding: '8px 16px', backgroundColor: appView === 'victim' ? '#3b82f6' : '#374151', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Victim Phone</button>
        <button onClick={() => setAppView('dispatcher')} style={{ padding: '8px 16px', backgroundColor: appView === 'dispatcher' ? '#3b82f6' : '#374151', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Dispatcher Map</button>
      </div>
      {appView === 'victim' ? renderVictimApp() : <Dispatcher />}
    </>
  );
}

function MobileFrame({ children }) {
  return (
    <div style={{ minHeight: '100vh', width: '100vw', backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ 
        width: '390px', height: '844px', backgroundColor: '#0a0a0a', 
        borderRadius: '40px', border: '8px solid #262626', 
        overflow: 'hidden', display: 'flex', flexDirection: 'column', 
        color: 'white', padding: '24px', position: 'relative'
      }}>
        {children}
      </div>
    </div>
  );
}

function EmergencyOption({ icon: Icon, label, isSelected, onClick }) {
  return (
    <button onClick={onClick} style={{ 
      backgroundColor: isSelected ? '#3b82f6' : '#1f2937', 
      border: isSelected ? '2px solid #60a5fa' : '1px solid #374151', 
      borderRadius: '12px', padding: '20px 10px', display: 'flex', flexDirection: 'column', 
      alignItems: 'center', gap: '12px', color: 'white', cursor: 'pointer',
      transition: 'all 0.2s'
    }}>
      <Icon size={32} />
      <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{label}</span>
    </button>
  );
}

export default App;