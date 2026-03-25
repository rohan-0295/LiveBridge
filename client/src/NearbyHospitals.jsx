import { useState, useEffect } from 'react';
import { MapPin, Navigation } from 'lucide-react';

export function NearbyHospitals({ latitude, longitude }) {
  const [hospitals, setHospitals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Safety check: Don't fetch if we don't have coordinates yet
    if (!latitude || !longitude) return;

    setLoading(true);
    
    fetch(`http://localhost:8000/api/hospitals/nearby?lat=${latitude}&lng=${longitude}`)
      .then(res => res.json())
      .then(data => {
        setHospitals(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch hospitals:", err);
        setLoading(false);
      });
      
  // 2. THE CRITICAL FIX: This array tells React to ONLY fetch when the coordinates change!
  }, [latitude, longitude]); 

  if (loading) {
    return (
      <div style={{ color: '#7d8590', fontSize: 12, padding: '16px 0', textAlign: 'center', fontFamily: "'DM Sans', sans-serif" }}>
        Scanning for nearby trauma centers...
      </div>
    );
  }

  if (hospitals.length === 0) {
    return (
      <div style={{ color: '#7d8590', fontSize: 12, padding: '16px 0', textAlign: 'center', fontFamily: "'DM Sans', sans-serif" }}>
        No hospitals found nearby.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#388bfd', letterSpacing: 1.5, fontFamily: "'Syne', sans-serif", marginBottom: 4 }}>
        NEARBY DESTINATION OPTIONS
      </div>
      
      {hospitals.map((h, i) => (
        <div key={i} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ background: '#1f3358', padding: '6px', borderRadius: '50%' }}>
              <MapPin size={16} color="#388bfd" />
            </div>
            <div>
              <div style={{ fontSize: 13, color: '#e6edf3', fontWeight: 500, fontFamily: "'DM Sans', sans-serif" }}>{h.name}</div>
              <div style={{ fontSize: 10, color: '#7d8590', fontFamily: 'monospace', marginTop: 2 }}>{parseFloat(h.lat).toFixed(4)}, {parseFloat(h.lng).toFixed(4)}</div>
            </div>
          </div>
          
          <button style={{ background: 'transparent', border: '1px solid #388bfd', borderRadius: 8, color: '#388bfd', padding: '8px 14px', fontSize: 10, fontWeight: 700, fontFamily: "'Syne', sans-serif", cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'background 0.2s' }}>
            <Navigation size={12} /> ROUTE
          </button>
        </div>
      ))}
    </div>
  );
}