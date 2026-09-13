const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const multer = require("multer");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// ── Photo upload setup: files now go STRAIGHT to Google Drive, not to disk ──
// PREVIOUSLY: multer.diskStorage() saved photos into a local "uploads/"
// folder on the server. That folder is NOT permanent — every time Railway
// restarts or redeploys the server, that folder is wiped and every photo
// saved there is lost forever.
// NOW: multer.memoryStorage() just holds the photo in memory for a moment,
// we immediately forward it to the same Google Apps Script the rest of the
// app already uses for Drive uploads, and we store the returned Drive link
// in the database instead of a local "/uploads/..." path. Nothing is ever
// written to the Railway server's disk, so nothing can be lost on restart.
const upload = multer({ storage: multer.memoryStorage() });

// Same Google Apps Script Web App + secret the frontend (index.html) already
// uses for all its Drive uploads (Memory Vault, Camera Trap, Staff photos,
// etc). Using the same one here keeps every photo in the same Drive folder.
const GSCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxDpdpyqa7yw1lHeVn1gXhoFQh7PpvwNoZopa-OmJIdOXeqGgw6MYFBWABOQQp2eRj4XQ/exec";
const APP_SECRET = "43e90fbb0f20609610f49afc68471f125b1072adf73b9489";

app.post("/api/upload-photo", upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).send("No photo received");
  try {
    // Turn the in-memory file into the same "data:image/...;base64,...."
    // format the frontend already sends to this same Apps Script.
    const base64DataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString(
      "base64"
    )}`;

    const gRes = await fetch(GSCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        secret: APP_SECRET,
        action: "uploadPhoto",
        filename: "entry_" + Date.now(),
        imageBase64: base64DataUrl,
      }),
    });
    const data = await gRes.json();

    if (data && data.ok && data.thumbUrl) {
      return res.json({ url: data.thumbUrl });
    }
    // Drive upload failed (script error, quota, etc) — tell the frontend
    // clearly rather than silently losing the photo.
    return res.status(502).send("Drive upload failed");
  } catch (err) {
    res.status(500).send("Error uploading photo: " + err.message);
  }
});

// ── Basic pages ──
app.get("/", (req, res) => {
  res.send("Bagh Prahari Backend Server is Running!");
});

app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.send("Database connected! Time: " + result.rows[0].now);
  } catch (err) {
    res.status(500).send("Database connection failed: " + err.message);
  }
});

// ── Entries: add ──
app.post("/api/entries", async (req, res) => {
  try {
    const {
      entry_date,
      entry_time,
      division,
      range,
      beat,
      local_area,
      species,
      tiger_id,
      leopard_id,
      wolf_id,
      remark,
      kill,
      latitude,
      longitude,
      created_by,
      photos,
    } = req.body;
    const result = await pool.query(
      `INSERT INTO entries (entry_date, entry_time, division, range, beat, local_area, species, tiger_id, leopard_id, wolf_id, remark, kill, latitude, longitude, created_by, photos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        entry_date,
        entry_time,
        division,
        range,
        beat,
        local_area,
        species,
        tiger_id,
        leopard_id,
        wolf_id,
        remark,
        kill,
        latitude,
        longitude,
        created_by,
        JSON.stringify(photos || []),
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Error saving entry: " + err.message);
  }
});

// ── Entries: view all ──
app.get("/api/entries", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM entries ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error fetching entries: " + err.message);
  }
});

// ── Entries: update (Edit Entry) ──
app.put("/api/entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      entry_date,
      entry_time,
      division,
      range,
      beat,
      local_area,
      species,
      tiger_id,
      leopard_id,
      wolf_id,
      remark,
      kill,
      latitude,
      longitude,
      photos,
    } = req.body;
    const result = await pool.query(
      `UPDATE entries SET entry_date=$1, entry_time=$2, division=$3, range=$4, beat=$5, local_area=$6, species=$7, tiger_id=$8, leopard_id=$9, wolf_id=$10, remark=$11, kill=$12, latitude=$13, longitude=$14, photos=$15
       WHERE id=$16 RETURNING *`,
      [
        entry_date,
        entry_time,
        division,
        range,
        beat,
        local_area,
        species,
        tiger_id,
        leopard_id,
        wolf_id,
        remark,
        kill,
        latitude,
        longitude,
        JSON.stringify(photos || []),
        id,
      ]
    );
    if (result.rows.length === 0)
      return res.status(404).send("Entry not found");
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Error updating entry: " + err.message);
  }
});

// ── Users: register (Add User) ──
app.post("/api/register", async (req, res) => {
  try {
    const { name, password, role, forestry_rank, range_area } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, password_hash, role, forestry_rank, range_area)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, role, forestry_rank, range_area`,
      [name, hash, role || "staff", forestry_rank, range_area]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Error registering user: " + err.message);
  }
});

// ── Users: login by name + password ──
app.post("/api/login", async (req, res) => {
  try {
    const { name, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE name = $1", [
      name,
    ]);
    if (result.rows.length === 0) {
      return res.status(401).send("User not found");
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).send("Wrong password");
    }
    res.json({
      id: user.id,
      name: user.name,
      role: user.role,
      forestry_rank: user.forestry_rank,
      range_area: user.range_area,
    });
  } catch (err) {
    res.status(500).send("Error logging in: " + err.message);
  }
});

// ── Users: login by password only (matches this app's single-code login screen) ──
app.post("/api/login-by-password", async (req, res) => {
  try {
    const { password } = req.body;
    const result = await pool.query("SELECT * FROM users");
    for (const user of result.rows) {
      const match = await bcrypt.compare(password, user.password_hash);
      if (match) {
        await pool.query(
          "INSERT INTO audit_log (action, user_name, detail) VALUES ($1,$2,$3)",
          ["login", user.name, user.role]
        );
        return res.json({
          id: user.id,
          name: user.name,
          role: user.role,
          forestry_rank: user.forestry_rank,
          range_area: user.range_area,
        });
      }
    }
    res.status(401).send("Invalid password");
  } catch (err) {
    res.status(500).send("Error logging in: " + err.message);
  }
});

// ── Audit log: view (who did what, when — server-side, tamper-proof) ──
app.get("/api/audit-log", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM audit_log ORDER BY id DESC LIMIT 200"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error fetching audit log: " + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server chal raha hai: http://localhost:" + PORT);
});
