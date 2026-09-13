const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// ── Photo upload setup: files land in an "uploads" folder next to server.js ──
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage });
app.use('/uploads', express.static('uploads'));

app.post('/api/upload-photo', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).send('No photo received');
  res.json({ url: '/uploads/' + req.file.filename });
});

// ── Basic pages ──
app.get('/', (req, res) => {
  res.send('Bagh Prahari Backend Server is Running!');
});

app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.send('Database connected! Time: ' + result.rows[0].now);
  } catch (err) {
    res.status(500).send('Database connection failed: ' + err.message);
  }
});

// ── Entries: add ──
app.post('/api/entries', async (req, res) => {
  try {
    const { entry_date, entry_time, division, range, beat, local_area, species, tiger_id, leopard_id, wolf_id, remark, kill, latitude, longitude, created_by, photos } = req.body;
    const result = await pool.query(
      `INSERT INTO entries (entry_date, entry_time, division, range, beat, local_area, species, tiger_id, leopard_id, wolf_id, remark, kill, latitude, longitude, created_by, photos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [entry_date, entry_time, division, range, beat, local_area, species, tiger_id, leopard_id, wolf_id, remark, kill, latitude, longitude, created_by, JSON.stringify(photos || [])]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send('Error saving entry: ' + err.message);
  }
});

// ── Entries: view all ──
app.get('/api/entries', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM entries ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send('Error fetching entries: ' + err.message);
  }
});

// ── Entries: update (Edit Entry) ──
app.put('/api/entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { entry_date, entry_time, division, range, beat, local_area, species, tiger_id, leopard_id, wolf_id, remark, kill, latitude, longitude, photos } = req.body;
    const result = await pool.query(
      `UPDATE entries SET entry_date=$1, entry_time=$2, division=$3, range=$4, beat=$5, local_area=$6, species=$7, tiger_id=$8, leopard_id=$9, wolf_id=$10, remark=$11, kill=$12, latitude=$13, longitude=$14, photos=$15
       WHERE id=$16 RETURNING *`,
      [entry_date, entry_time, division, range, beat, local_area, species, tiger_id, leopard_id, wolf_id, remark, kill, latitude, longitude, JSON.stringify(photos || []), id]
    );
    if (result.rows.length === 0) return res.status(404).send('Entry not found');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send('Error updating entry: ' + err.message);
  }
});

// ── Users: register (Add User) ──
app.post('/api/register', async (req, res) => {
  try {
    const { name, password, role, forestry_rank, range_area } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, password_hash, role, forestry_rank, range_area)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, role, forestry_rank, range_area`,
      [name, hash, role || 'staff', forestry_rank, range_area]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send('Error registering user: ' + err.message);
  }
});

// ── Users: login by name + password ──
app.post('/api/login', async (req, res) => {
  try {
    const { name, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE name = $1', [name]);
    if (result.rows.length === 0) {
      return res.status(401).send('User not found');
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).send('Wrong password');
    }
    res.json({ id: user.id, name: user.name, role: user.role, forestry_rank: user.forestry_rank, range_area: user.range_area });
  } catch (err) {
    res.status(500).send('Error logging in: ' + err.message);
  }
});

// ── Users: login by password only (matches this app's single-code login screen) ──
app.post('/api/login-by-password', async (req, res) => {
  try {
    const { password } = req.body;
    const result = await pool.query('SELECT * FROM users');
    for (const user of result.rows) {
      const match = await bcrypt.compare(password, user.password_hash);
      if (match) {
        await pool.query(
          'INSERT INTO audit_log (action, user_name, detail) VALUES ($1,$2,$3)',
          ['login', user.name, user.role]
        );
        return res.json({ id: user.id, name: user.name, role: user.role, forestry_rank: user.forestry_rank, range_area: user.range_area });
      }
    }
    res.status(401).send('Invalid password');
  } catch (err) {
    res.status(500).send('Error logging in: ' + err.message);
  }
});

// ── Audit log: view (who did what, when — server-side, tamper-proof) ──
app.get('/api/audit-log', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200');
    res.json(result.rows);
  } catch (err) {
    res.status(500).send('Error fetching audit log: ' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server chal raha hai: http://localhost:' + PORT);
});