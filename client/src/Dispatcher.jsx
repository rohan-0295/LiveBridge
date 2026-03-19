import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { LayoutDashboard, Map as MapIcon, Users, Truck, User, LogOut, Ambulance } from 'lucide-react';

export default function Dispatcher() {
  const [activeTab, setActiveTab] = useState('Map View');
  const [emergencies, setEmergencies] = useState([]); 

  // --- FETCH LIVE DATA FROM NODE.JS ---
  useEffect(() => {
    const fetchEmergencies = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/emergencies');
        const data = await response.json();
        setEmergencies(data);
      } catch (error) {
        console.error("Failed to fetch live emergencies:", error);
      }
    };

    fetchEmergencies(); // Fetch immediately on load
    
    // Auto-refresh the map every 3 seconds to look for new SOS signals!
    const interval = setInterval(fetchEmergencies, 3000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard },
    { name: 'Map View', icon: MapIcon },
    { name: 'Victims List', icon: Users },
    { name: 'Ambulance List', icon: Truck },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', backgroundColor: '#0f172a', color: 'white' }}>
      
      {/* SIDEBAR */}
      <div style={{ width: '260px', backgroundColor: '#1e293b', display: 'flex', flexDirection: 'column', borderRight: '1px solid #334155' }}>
        <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid #334155' }}>
          <Ambulance size={32} color="white" />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', lineHeight: '1.2' }}>Ambulance<br/>Dispatcher</h2>
        </div>

        <div style={{ flex: 1, padding: '24px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.name;
            return (
              <button 
                key={item.name} onClick={() => setActiveTab(item.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                  backgroundColor: isActive ? '#3b82f6' : 'transparent', color: isActive ? 'white' : '#cbd5e1',
                  border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1rem', textAlign: 'left', transition: 'all 0.2s'
                }}
              >
                <Icon size={20} /> {item.name}
              </button>
            )
          })}
        </div>

        <div style={{ padding: '24px', borderTop: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <button style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer' }}>
            <LogOut size={20} /> Logout
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
            <div style={{ width: '40px', height: '40px', backgroundColor: '#475569', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
              RS
            </div>
            <div>
              <p style={{ fontWeight: 'bold', margin: 0 }}>Rohan Shaw</p>
              <p style={{ fontSize: '0.8rem', color: '#22c55e', margin: 0 }}>Online</p>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN MAP AREA */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: '70px', backgroundColor: '#64748b', display: 'flex', alignItems: 'center', padding: '0 24px', justifyContent: 'space-between', zIndex: 1000 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>LiveMap View</h1>
          <div style={{ display: 'flex', gap: '20px' }}>
             <span style={{ color: '#fca5a5', fontWeight: 'bold' }}>ACTIVE SOS: {emergencies.length}</span>
          </div>
        </div>

        {/* THE LEAFLET MAP */}
        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer center={[13.0827, 80.2707]} zoom={11} style={{ height: '100%', width: '100%', zIndex: 0 }}>
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            
            {/* Draw a marker for EVERY emergency in the database! */}
            {emergencies.map((emergency) => (
              <Marker key={emergency.id} position={[emergency.latitude, emergency.longitude]}>
                <Popup>
                  <div style={{ color: '#111827' }}>
                    <strong style={{ color: emergency.severity_score === 'Critical' ? '#ef4444' : '#f59e0b', fontSize: '1.1rem' }}>
                      SOS #{emergency.id} - {emergency.severity_score.toUpperCase()}
                    </strong><br/>
                    <span style={{ color: '#4b5563' }}>Status: {emergency.status}</span><br/>
                    <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                      Time: {new Date(emergency.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                </Popup>
              </Marker>
            ))}

          </MapContainer>
        </div>
      </div>
    </div>
  );
}