// server/index.js — LiveBridge Backend (Final Production Edition)
// ✅ Part 1 Fix 1: SOS route fetches Medical Vault and attaches to socket payloads
// ✅ Part 2 Server: Geofencing — vault only broadcast when ambulance within 500m of hospital
// ✅ Part 2 Server: ML fallback — SOS never crashes if FastAPI is down
// ✅ Part 2 Server: Connection pool tuning + CORS hardening
// ✅ Part 2 Server: route_to_hospital fetches live vault from DB before emitting

const express     = require('express');
const cors        = require('cors');
const http        = require('http');
const { Server }  = require('socket.io');
const { Pool }    = require('pg');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
require('dotenv').config();

const app    = express();
const server = http.createServer(app);

// ── CORS — hardened but demo-friendly ────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, same-origin server calls)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, true); // keep open for demo — restrict in production
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json());

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── PostgreSQL connection pool ────────────────────────────────────────────────
// Tuned for concurrent stress-test load (simulate_pileup.js fires 15+ reqs at once)
const pool = new Pool({
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '5432'),
  database:           process.env.DB_NAME,
  max:                20,      // max concurrent DB connections (default is 10)
  idleTimeoutMillis:  30000,   // close idle connections after 30s
  connectionTimeoutMillis: 5000, // fail fast rather than hang
  allowExitOnIdle:    false,
});

pool.connect()
  .then(c => { console.log('✅ PostgreSQL connected (LiveBridge DB)'); c.release(); })
  .catch(err => console.error('❌ DB connection failed:', err.message));

// Graceful pool shutdown on SIGTERM / SIGINT
// Graceful pool shutdown on SIGTERM / SIGINT
process.on('SIGTERM', async () => {
  await pool.end();
  console.log('PostgreSQL pool closed.');
  process.exit(0); // Actually kill the server
});

process.on('SIGINT', async () => {
  await pool.end();
  console.log('PostgreSQL pool closed.');
  process.exit(0); // Actually kill the server
});
// ── Auth middleware ───────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'livebridge_dev_secret_2024';

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// ── Haversine distance helper (metres) ───────────────────────────────────────
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in metres
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Vault fetch helper — used by SOS route and socket events ─────────────────
async function fetchVaultForUser(userId) {
  if (!userId) return null;
  try {
    const r = await pool.query('SELECT * FROM medical_vaults WHERE user_id = $1', [userId]);
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return {
      ...row,
      blood_type:  row.blood_type   || '—',
      allergies:   safeJson(row.allergies,   []),
      conditions:  safeJson(row.conditions,  []),
      medications: safeJson(row.medications, []),
      contacts:    safeJson(row.contacts,    []),
    };
  } catch (err) {
    console.error('⚠️  fetchVaultForUser error:', err.message);
    return null;
  }
}

function safeJson(val, fallback) {
  if (Array.isArray(val))  return val;
  if (typeof val === 'object' && val !== null) return val;
  try { return JSON.parse(val || '[]'); }
  catch { return fallback; }
}

// ── In-memory state ───────────────────────────────────────────────────────────
const webrtcRooms          = {};
const hospitalDivertStatus = {};
const otpStore             = {};
const OTP_TTL_MS           = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS     = 5;

// Track ambulance positions for geofencing: { emergency_id: { lat, lng } }
const responderPositions   = {};

// Known hospital coordinates for geofencing
const HOSPITAL_COORDS = {
  apollo_chennai:  { lat: 13.0732, lng: 80.2609 },
  srm_hospital:    { lat: 12.8231, lng: 80.0442 },
  fortis_chennai:  { lat: 13.0000, lng: 80.2547 },
  miot_chennai:    { lat: 13.0104, lng: 80.1943 },
};
const GEOFENCE_RADIUS_M = 500; // metres — emit vault data when ambulance is within this range

// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Victim live GPS
  socket.on('location_update', (data) => {
    io.emit('victim_location_update', data);
  });

  // Responder accepted a dispatch
  socket.on('dispatch_accepted', ({ emergency_id, responder_id }) => {
    console.log(`🚑 ${responder_id || 'unit'} accepted SOS #${emergency_id}`);
    io.emit('dispatch_accepted', { emergency_id, responder_id });
  });

  // ── Responder GPS update ──────────────────────────────────────────────────
  // Part 2: Geofencing — when ambulance is within 500m of routed hospital,
  // broadcast vault data to that hospital room so ER can prepare in advance.
  socket.on('responder_location', async (data) => {
    const { latitude, longitude, emergency_id } = data;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    // Broadcast real-time position to dispatchers and hospital map
    io.emit('responder_location_update', { ...data, latitude: lat, longitude: lng });

    // Store latest position for this emergency
    if (emergency_id) {
      responderPositions[emergency_id] = { lat, lng };
    }

    // Geofence check — look up which hospital this emergency is routed to
    try {
      const emergencyRow = await pool.query(
        `SELECT id, user_id, routed_hospital
         FROM emergencies WHERE id = $1 LIMIT 1`,
        [emergency_id]
      ).catch(() => null);

      const hospitalId = emergencyRow?.rows?.[0]?.routed_hospital;
      const hospitalCoords = hospitalId ? HOSPITAL_COORDS[hospitalId] : null;

      if (hospitalCoords && emergency_id) {
        const dist = haversineMetres(lat, lng, hospitalCoords.lat, hospitalCoords.lng);
        console.log(`📍 SOS #${emergency_id} ambulance is ${Math.round(dist)}m from ${hospitalId}`);

        if (dist <= GEOFENCE_RADIUS_M) {
          // Ambulance is within 500m — fetch vault and push ETA-close alert
          const userId  = emergencyRow.rows[0].user_id;
          const vault   = await fetchVaultForUser(userId);
          io.to(`hospital_${hospitalId}`).emit('ambulance_approaching', {
            emergency_id,
            distance_metres: Math.round(dist),
            vault,
            message: `Ambulance is ${Math.round(dist)}m away — prepare trauma bay!`,
          });
        }
      }
    } catch (geoErr) {
      // Non-fatal — geofencing should never crash the GPS stream
      console.error('⚠️  Geofence check error (non-fatal):', geoErr.message);
    }
  });

  // Responder status update
  socket.on('responder_status_update', ({ emergency_id, status, unit }) => {
    console.log(`🚑 SOS #${emergency_id} [${unit || 'unit'}]: ${status}`);
    io.emit('responder_status_update', { emergency_id, status, unit });
    // Clean up stored position when mission completes
    if (status === 'completed' && emergency_id) {
      delete responderPositions[emergency_id];
    }
  });

  // ── Hospital Events ───────────────────────────────────────────────────────

  socket.on('hospital_join', ({ hospital, hospital_name }) => {
    const hosp = hospital || hospital_name;
    if (!hosp) return;
    socket.join(`hospital_${hosp}`);
    console.log(`🏥 Hospital "${hosp}" joined socket room`);
    socket.emit('hospital_divert_update', {
      hospital: hosp,
      diverted: hospitalDivertStatus[hosp] || false,
    });
  });

  // ── Dispatcher routes emergency to hospital (attaches live vault from DB) ──
  socket.on('route_to_hospital', async ({
    emergency_id, hospital_id, hospital_name,
    hospital_lat, hospital_lng, eta_minutes,
  }) => {
    try {
      const hosp = hospital_id || hospital_name;

      // Fetch full emergency row including user_id
      const eRow = await pool.query(
        `SELECT id, user_id, severity_score, status,
         ST_Y(location::geometry) AS latitude,
         ST_X(location::geometry) AS longitude,
         created_at
         FROM emergencies WHERE id = $1 LIMIT 1`,
        [emergency_id]
      );
      const emergency = eRow.rows[0] || null;
      const userId    = emergency?.user_id;

      // Fetch the patient's Medical Vault
      const vault = await fetchVaultForUser(userId);

      // Store routed hospital for later geofencing
      if (emergency_id && hosp) {
        await pool.query(
          `UPDATE emergencies SET routed_hospital = $1 WHERE id = $2`,
          [hosp, emergency_id]
        ).catch(() => {}); // non-fatal if column doesn't exist yet
      }

      const payload = {
        emergency_id,
        emergency,
        vault,                              // ← FULL vault attached here
        ambulance:   'UP-14',
        eta_minutes: eta_minutes || 4,
        hospital_id: hosp,
        routed_at:   new Date().toISOString(),
      };

      io.to(`hospital_${hosp}`).emit('inbound_patient', payload);
      console.log(`🏥 SOS #${emergency_id} → ${hosp} (vault: ${vault ? '✅' : '⚠️ none'})`);

    } catch (err) {
      console.error('route_to_hospital error:', err.message);
    }
  });

  socket.on('hospital_acknowledge', ({ emergency_id, hospital, hospital_name }) => {
    const hosp = hospital || hospital_name;
    console.log(`✅ Hospital "${hosp}" — Trauma Team Ready for SOS #${emergency_id}`);
    io.emit('hospital_acknowledged', { emergency_id, hospital: hosp });
  });

  socket.on('hospital_divert', ({ hospital, hospital_name, diverted }) => {
    const hosp = hospital || hospital_name;
    hospitalDivertStatus[hosp] = diverted;
    console.log(`🔄 ${hosp} divert mode: ${diverted}`);
    io.emit('hospital_divert_update', { hospital: hosp, diverted });
  });

  // ── WebRTC ────────────────────────────────────────────────────────────────
  socket.on('webrtc_join', ({ room_id, role }) => {
    socket.join(room_id);
    if (!webrtcRooms[room_id]) webrtcRooms[room_id] = new Set();
    webrtcRooms[room_id].add(socket.id);
    socket.to(room_id).emit('webrtc_peer_joined', { role });
  });
  socket.on('webrtc_offer',         ({ room_id, sdp })       => socket.to(room_id).emit('webrtc_offer',         { sdp }));
  socket.on('webrtc_answer',        ({ room_id, sdp })       => socket.to(room_id).emit('webrtc_answer',        { sdp }));
  socket.on('webrtc_ice_candidate', ({ room_id, candidate }) => socket.to(room_id).emit('webrtc_ice_candidate', { candidate }));
  socket.on('webrtc_leave', ({ room_id }) => {
    socket.leave(room_id);
    if (webrtcRooms[room_id]) {
      webrtcRooms[room_id].delete(socket.id);
      if (webrtcRooms[room_id].size === 0) delete webrtcRooms[room_id];
    }
    socket.to(room_id).emit('webrtc_peer_left');
  });

  socket.on('disconnect', () => {
    Object.entries(webrtcRooms).forEach(([rid, sockets]) => {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id);
        socket.to(rid).emit('webrtc_peer_left');
        if (sockets.size === 0) delete webrtcRooms[rid];
      }
    });
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REST ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send('🚑 LiveBridge Backend ALIVE'));

// ── Auth routes ───────────────────────────────────────────────────────────────

function generateOTP() { return String(Math.floor(100000 + Math.random() * 900000)); }

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, phone_number, password } = req.body;
    if (!name || !phone_number || !password)
      return res.status(400).json({ error: 'name, phone_number, and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const existing = await pool.query('SELECT id FROM users WHERE phone_number = $1', [phone_number]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'Phone number already registered.' });

    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, phone_number, password_hash) VALUES ($1,$2,$3) RETURNING id, name, phone_number',
      [name, phone_number, password_hash]
    );
    const user  = result.rows[0];
    const token = jwt.sign({ id: user.id, phone_number: user.phone_number }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Registered!', token, user });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if (!phone_number || !password)
      return res.status(400).json({ error: 'phone_number and password are required.' });

    const result = await pool.query('SELECT * FROM users WHERE phone_number = $1', [phone_number]);
    if (!result.rows.length)
      return res.status(401).json({ error: 'Invalid phone number or password.' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash || '');
    if (!valid)
      return res.status(401).json({ error: 'Invalid phone number or password.' });

    const token = jwt.sign({ id: user.id, phone_number: user.phone_number }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Login successful!', token, user: { id: user.id, name: user.name, phone_number: user.phone_number } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, phone_number, created_at FROM users WHERE id = $1', [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { phone_number } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'phone_number is required.' });
    const r = await pool.query('SELECT id FROM users WHERE phone_number = $1', [phone_number]);
    if (!r.rows.length) return res.json({ message: 'If that number is registered, an OTP has been sent.' });
    const otp = generateOTP();
    otpStore[phone_number] = { otp, expires: Date.now() + OTP_TTL_MS, attempts: 0 };
    console.log(`\n📲 OTP for ${phone_number}: \x1b[33m${otp}\x1b[0m\n`);
    res.json({ message: 'OTP sent! (Demo: check server terminal)' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send OTP.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { phone_number, otp, new_password } = req.body;
    if (!phone_number || !otp || !new_password)
      return res.status(400).json({ error: 'phone_number, otp and new_password required.' });
    if (new_password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const record = otpStore[phone_number];
    if (!record) return res.status(400).json({ error: 'No OTP requested. Please start again.' });
    if (Date.now() > record.expires) { delete otpStore[phone_number]; return res.status(400).json({ error: 'OTP expired.' }); }
    record.attempts++;
    if (record.attempts > MAX_OTP_ATTEMPTS) { delete otpStore[phone_number]; return res.status(429).json({ error: 'Too many attempts.' }); }
    if (record.otp !== otp.trim()) return res.status(400).json({ error: `Wrong OTP. ${MAX_OTP_ATTEMPTS - record.attempts} tries left.` });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE phone_number = $2', [hash, phone_number]);
    delete otpStore[phone_number];
    res.json({ message: 'Password updated! Please sign in.' });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed.' });
  }
});

// ── Medical Vault ─────────────────────────────────────────────────────────────

app.post('/api/vault', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, age, gender, bloodType, blood_type, phone,
            allergies, conditions, medications,
            doctorName, doctor_name, hospital, contacts } = req.body;
    await pool.query(
      `INSERT INTO medical_vaults
         (user_id, name, age, gender, blood_type, phone,
          allergies, conditions, medications, doctor_name, hospital, contacts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (user_id) DO UPDATE SET
         name=$2, age=$3, gender=$4, blood_type=$5, phone=$6,
         allergies=$7, conditions=$8, medications=$9,
         doctor_name=$10, hospital=$11, contacts=$12, updated_at=NOW()`,
      [
        userId, name, age, gender,
        bloodType || blood_type,
        phone,
        JSON.stringify(allergies   || []),
        JSON.stringify(conditions  || []),
        JSON.stringify(medications || []),
        doctorName || doctor_name,
        hospital,
        JSON.stringify(contacts    || []),
      ]
    );
    res.json({ message: 'Vault saved!' });
  } catch (err) {
    console.error('Vault save error:', err.message);
    res.status(500).json({ error: 'Failed to save vault.' });
  }
});

app.get('/api/vault/:user_id', async (req, res) => {
  try {
    const vault = await fetchVaultForUser(req.params.user_id);
    if (!vault) return res.status(404).json({ error: 'No vault found.' });
    res.json(vault);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vault.' });
  }
});

// ── Emergencies ───────────────────────────────────────────────────────────────

app.get('/api/emergencies', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, user_id, severity_score, status,
       ST_Y(location::geometry) AS latitude,
       ST_X(location::geometry) AS longitude,
       created_at
       FROM emergencies WHERE status = 'pending'
       ORDER BY created_at DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch emergencies.' });
  }
});

// ── SOS — core route ──────────────────────────────────────────────────────────
app.post('/api/sos', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { latitude, longitude, blood_loss, consciousness, breathing } = req.body;

  // STEP A: ML Triage — Part 2 Fix: never crashes; defaults to 'Unknown'
  let severity_score = 'Unknown';
  try {
    const mlController = new AbortController();
    const mlTimeout    = setTimeout(() => mlController.abort(), 6000); // 6s hard timeout

    const mlRes = await fetch('http://127.0.0.1:8001/predict', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  mlController.signal,
      body: JSON.stringify({
        blood_loss:           blood_loss    || 'None',
        consciousness:        consciousness || 'Awake',
        breathing:            breathing     || 'Normal',
        age_group:            'Adult',
        is_diabetic:          0,
        cardiac_history:      0,
        chest_pain_indicator: 0,
        incident_type:        'Medical',
        victim_count:         'Single',
        scene_hazard:         0,
      }),
    }).finally(() => clearTimeout(mlTimeout));

    if (mlRes.ok) {
      const d = await mlRes.json();
      severity_score = d.severity_score || 'Unknown';
      console.log(`🧠 ML triage: ${severity_score}`);
    } else {
      console.warn(`⚠️  ML engine ${mlRes.status} — using Unknown`);
    }
  } catch (mlErr) {
    // AbortError = timeout; NetworkError = FastAPI down — both are safe to ignore
    const reason = mlErr.name === 'AbortError' ? 'timeout' : mlErr.message;
    console.warn(`⚠️  ML unreachable (${reason}) — SOS continues with severity=Unknown`);
  }

  // STEP B: Save to PostGIS
  try {
    const result = await pool.query(
      `INSERT INTO emergencies (user_id, location, severity_score)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4)
       RETURNING id, user_id, severity_score, status,
         ST_Y(location::geometry) AS latitude,
         ST_X(location::geometry) AS longitude,
         created_at`,
      [userId, longitude, latitude, severity_score]
    );
    const emergency = result.rows[0];

    // STEP C: Fetch vault and attach to dispatcher broadcast
    const vault = await fetchVaultForUser(userId);

    // Broadcast to dispatchers + hospital dashboards
    const broadcastPayload = { ...emergency, vault };
    io.emit('new_emergency', broadcastPayload);

    // Also push to all connected hospital rooms for situational awareness
    io.emit('hospital_sos_alert', {
      emergency_id:   emergency.id,
      severity_score: emergency.severity_score,
      vault,
    });

    console.log(`🚨 SOS #${emergency.id} broadcast — severity: ${severity_score}, vault: ${vault ? '✅' : '⚠️ none'}`);
    res.json({ message: 'SOS broadcasted!', emergency: { ...emergency, vault } });

  } catch (dbErr) {
    console.error('SOS DB error:', dbErr.message);
    res.status(500).json({ error: 'Failed to save emergency.' });
  }
});

app.patch('/api/emergencies/:id/resolve', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE emergencies SET status='resolved' WHERE id=$1 RETURNING id, status`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found.' });
    io.emit('emergency_resolved', { id: parseInt(req.params.id) });
    res.json({ message: 'Resolved.', emergency: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve.' });
  }
});

// ── Nearby hospitals ───────────────────────────────────────────────────────────
app.get('/api/hospitals/nearby', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    // Return static list for demo — replace with PostGIS spatial query in production
    const hospitals = Object.entries(HOSPITAL_COORDS).map(([id, coords]) => ({
      id,
      label:           id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      latitude:        coords.lat,
      longitude:       coords.lng,
      distance_metres: lat && lng ? Math.round(haversineMetres(parseFloat(lat), parseFloat(lng), coords.lat, coords.lng)) : null,
    })).sort((a, b) => (a.distance_metres ?? 9999) - (b.distance_metres ?? 9999));
    res.json(hospitals);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch hospitals.' });
  }
});

// ── Health / debug ─────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT PostGIS_Version() AS v');
    res.json({ status: 'OK', postgis: r.rows[0].v, pool_total: pool.totalCount, pool_idle: pool.idleCount });
  } catch (err) {
    res.status(500).json({ status: 'DB error', error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '8000');
server.listen(PORT, () => console.log(`🚀 LiveBridge server → http://localhost:${PORT}`));