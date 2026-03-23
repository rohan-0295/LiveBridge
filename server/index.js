const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const { Server } = require('socket.io');
const { Pool }   = require('pg');
require('dotenv').config();

const app    = express();
const server = http.createServer(app);         // wrap express in http server for socket.io
const io     = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// ── Database ────────────────────────────────────────────────────────────────
const pool = new Pool({
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    database: process.env.DB_NAME,
});

pool.connect()
    .then(() => console.log('✅ Connected to PostgreSQL Database (LiveBridge DB)!'))
    .catch(err => console.error('❌ Database connection error:', err.stack));

// ── Socket.io ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`🔌 Dispatcher connected: ${socket.id}`);

    // Victim is sharing live location — re-broadcast to all dispatchers
    socket.on('location_update', (data) => {
        // data: { user_id, emergency_id, latitude, longitude, accuracy }
        io.emit('victim_location_update', data);
    });

    // Responder accepted a dispatch
    socket.on('dispatch_accepted', ({ emergency_id, responder_id }) => {
        console.log(`🚑 ${responder_id} accepted SOS #${emergency_id}`);
        io.emit('dispatch_accepted', { emergency_id, responder_id });
    });

    // Responder broadcasting their GPS position en route
    socket.on('responder_location', (data) => {
        io.emit('responder_location_update', data);
    });

    // Responder status changed (en_route → arrived → completed)
    socket.on('responder_status_update', ({ emergency_id, status }) => {
        console.log(`🚑 SOS #${emergency_id} responder status: ${status}`);
        io.emit('responder_status_update', { emergency_id, status });
    });

    socket.on('disconnect', () => console.log(`🔌 Disconnected: ${socket.id}`));
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('🚑 LiveBridge Backend is ALIVE!'));

app.get('/api/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT PostGIS_Version();');
        res.json({ status: 'Success!', postgis_version: result.rows[0].postgis_version });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database query failed.' });
    }
});

// Fetch all active emergencies for the Dispatcher Map
app.get('/api/emergencies', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, user_id, severity_score, status,
             ST_Y(location::geometry) AS latitude,
             ST_X(location::geometry) AS longitude,
             created_at
             FROM emergencies
             WHERE status = 'pending'
             ORDER BY created_at DESC;`
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to fetch emergencies.' });
    }
});

// Register a new user
app.post('/api/users', async (req, res) => {
    try {
        const { name, phone_number } = req.body;
        const result = await pool.query(
            'INSERT INTO users (name, phone_number) VALUES ($1, $2) RETURNING *',
            [name, phone_number]
        );
        res.json({ message: 'User created!', user: result.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to create user.' });
    }
});

// Save / update medical vault for a user
app.post('/api/vault', async (req, res) => {
    try {
        const {
            user_id, name, age, gender, bloodType, phone,
            allergies, conditions, medications,
            doctorName, hospital, contacts
        } = req.body;

        // Upsert: insert or update if user_id already has a vault
        await pool.query(
            `INSERT INTO medical_vaults
               (user_id, name, age, gender, blood_type, phone,
                allergies, conditions, medications, doctor_name, hospital, contacts)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (user_id) DO UPDATE SET
               name         = EXCLUDED.name,
               age          = EXCLUDED.age,
               gender       = EXCLUDED.gender,
               blood_type   = EXCLUDED.blood_type,
               phone        = EXCLUDED.phone,
               allergies    = EXCLUDED.allergies,
               conditions   = EXCLUDED.conditions,
               medications  = EXCLUDED.medications,
               doctor_name  = EXCLUDED.doctor_name,
               hospital     = EXCLUDED.hospital,
               contacts     = EXCLUDED.contacts,
               updated_at   = NOW()`,
            [
                user_id, name, age, gender, bloodType, phone,
                JSON.stringify(allergies),
                JSON.stringify(conditions),
                JSON.stringify(medications),
                doctorName, hospital,
                JSON.stringify(contacts),
            ]
        );

        res.json({ message: 'Vault saved!' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to save vault.' });
    }
});

// Fetch vault for a user (used by Responder/Hospital)
app.get('/api/vault/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;
        const result = await pool.query(
            'SELECT * FROM medical_vaults WHERE user_id = $1', [user_id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'No vault found.' });
        const row = result.rows[0];
        res.json({
            ...row,
            allergies:   JSON.parse(row.allergies   || '[]'),
            conditions:  JSON.parse(row.conditions  || '[]'),
            medications: JSON.parse(row.medications || '[]'),
            contacts:    JSON.parse(row.contacts    || '[]'),
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to fetch vault.' });
    }
});

// ── SOS — core route ────────────────────────────────────────────────────────
app.post('/api/sos', async (req, res) => {
    try {
        const { user_id, latitude, longitude, blood_loss, consciousness, breathing } = req.body;

        // STEP A: Call Python ML microservice
        // FIX: Provide defaults for all required FastAPI fields to prevent 422 errors.
        // The victim phone only collects 3 vitals; the rest are safe clinical defaults.
        let severity_score = 'Unknown';
        try {
            const aiResponse = await fetch('http://localhost:8001/predict', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // Fields from victim phone
                    blood_loss:    blood_loss    || 'None',
                    consciousness: consciousness || 'Awake',
                    breathing:     breathing     || 'Normal',
                    // Required FastAPI fields — safe defaults
                    age_group:          'Adult',
                    is_diabetic:        0,
                    cardiac_history:    0,
                    chest_pain_indicator: 0,
                    incident_type:      'Medical',
                    victim_count:       'Single',
                    scene_hazard:       0,
                }),
            });

            if (aiResponse.ok) {
                const aiData = await aiResponse.json();
                severity_score = aiData.severity_score || 'Unknown';
            } else {
                console.error('⚠️  ML engine returned:', aiResponse.status, await aiResponse.text());
            }
        } catch (mlErr) {
            // ML engine down — don't crash the SOS, just mark Unknown
            console.error('⚠️  ML engine unreachable:', mlErr.message);
        }

        // STEP B: Save to PostGIS
        const result = await pool.query(
            `INSERT INTO emergencies (user_id, location, severity_score)
             VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4)
             RETURNING id, user_id, severity_score, status,
               ST_Y(location::geometry) AS latitude,
               ST_X(location::geometry) AS longitude,
               created_at`,
            [user_id, longitude, latitude, severity_score]
        );

        const emergency = result.rows[0];

        // STEP C: Push to all connected Dispatcher clients instantly via Socket.io
        io.emit('new_emergency', emergency);
        console.log(`🚨 SOS #${emergency.id} broadcast to dispatchers — severity: ${severity_score}`);

        res.json({ message: 'SOS Broadcasted & Triaged via AI!', emergency });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to broadcast SOS.' });
    }
});

// Mark an emergency as resolved
app.patch('/api/emergencies/:id/resolve', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE emergencies SET status = 'resolved' WHERE id = $1
             RETURNING id, status`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Emergency not found.' });

        io.emit('emergency_resolved', { id: parseInt(id) });
        res.json({ message: 'Emergency resolved.', emergency: result.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to resolve emergency.' });
    }
});

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {                    // NOTE: server.listen, not app.listen
    console.log(`🚀 LiveBridge server running on http://localhost:${PORT}`);
});