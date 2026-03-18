const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config(); // Loads your .env file

const app = express();
app.use(cors());
app.use(express.json());

// 1. Set up the Database Connection Pool
const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
});

// 2. Test the connection on startup
pool.connect()
    .then(() => console.log('✅ Connected to PostgreSQL Database (LiveBridge DB)!'))
    .catch(err => console.error('❌ Database connection error:', err.stack));

// 3. Base Route
app.get('/', (req, res) => {
    res.send('🚑 LiveBridge Backend is ALIVE!');
});

// 4. PostGIS Verification Route
app.get('/api/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT PostGIS_Version();');
        res.json({ 
            status: "Success! Database is talking to Node.",
            postgis_version: result.rows[0].postgis_version 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database query failed." });
    }
});


// --- NEW LIVEBRIDGE API ROUTES ---

// 1. Register a New User (Restored!)
app.post('/api/users', async (req, res) => {
    try {
        const { name, phone_number } = req.body;
        const newUser = await pool.query(
            "INSERT INTO users (name, phone_number) VALUES ($1, $2) RETURNING *",
            [name, phone_number]
        );
        res.json({ message: "User created!", user: newUser.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Failed to create user." });
    }
});


// 2. Trigger an SOS (With Spatial GPS & AI Triage)
app.post('/api/sos', async (req, res) => {
    try {
        // Now we accept injury details from the phone!
        const { user_id, latitude, longitude, blood_loss, consciousness, breathing } = req.body;
        
        // --- STEP A: Ask the Python Microservice for the Severity ---
        const aiResponse = await fetch('http://localhost:8001/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blood_loss, consciousness, breathing })
        });
        
        const aiData = await aiResponse.json();
        const severity_score = aiData.severity_score; // Extracts "Critical", "High", or "Low"

        // --- STEP B: Save everything to PostGIS ---
        const newSOS = await pool.query(
            "INSERT INTO emergencies (user_id, location, severity_score) VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4) RETURNING id, user_id, severity_score, status",
            [user_id, longitude, latitude, severity_score] 
        );
        
        res.json({ 
            message: "SOS Broadcasted & Triaged via AI!", 
            emergency: newSOS.rows[0] 
        });
        
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Failed to broadcast SOS." });
    }
});

// 5. Start Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});