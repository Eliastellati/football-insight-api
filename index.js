import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

import { cacheGet, cacheSet } from "./cache.js";
import { fdGet } from "./footballData.js";
import { TOP_COMPETITIONS } from "./config.js";
import { pool } from "./db.js";

const app = express();

// Fix Railway + express-rate-limit
app.set("trust proxy", 1);

// Middlewares
app.use(express.json());
// per ora lasciamo "*" (aperto). Dopo lo restringiamo a Vercel.
app.use(cors({ origin: "*" }));

app.use(
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

/* =========================
   ADMIN (schema mapping)
   ========================= */

function requireAdmin(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return res.status(500).json({ ok: false, error: "ADMIN_TOKEN not set" });
  }

  const got = req.get("x-admin-token");
  if (got !== token) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  next();
}

// Schema mapping: api_cache1 (columns + indexes + constraints)
app.get("/api/admin/describe/api_cache1", requireAdmin, async (_req, res) => {
  try {
    const columns = await pool.query(`
      SELECT
        ordinal_position,
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'api_cache1'
      ORDER BY ordinal_position;
    `);

    const indexes = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'api_cache1'
      ORDER BY indexname;
    `);

    const constraints = await pool.query(`
      SELECT
        conname AS constraint_name,
        contype AS constraint_type,
        pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      WHERE c.conrelid = 'public.api_cache1'::regclass
      ORDER BY contype, conname;
    `);

    res.json({
      ok: true,
      table: "public.api_cache1",
      columns: columns.rows,
      indexes: indexes.rows,
      constraints: constraints.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.post("/api/admin/migrate/api_cache1-timestamps", requireAdmin, async (req, res) => {
  try {
    // Leggi tipi attuali
    const before = await pool.query(`
      SELECT column_name, data_type, udt_name, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='api_cache1'
      ORDER BY ordinal_position;
    `);

    // Migra DATE -> TIMESTAMPTZ
    await pool.query(`
      ALTER TABLE public.api_cache1
        ALTER COLUMN expires_at TYPE timestamptz USING expires_at::timestamptz,
        ALTER COLUMN created_at TYPE timestamptz USING created_at::timestamptz;
    `);

    // Default sensato (created_at = now)
    await pool.query(`
      ALTER TABLE public.api_cache1
        ALTER COLUMN created_at SET DEFAULT NOW();
    `);

    // (Consigliato) svuota la cache vecchia, perché era “invalidata” dal bug
    // Puoi disattivarlo se vuoi: commenta questa riga.
    await pool.query(`TRUNCATE TABLE public.api_cache1;`);

    // Output dopo
    const after = await pool.query(`
      SELECT column_name, data_type, udt_name, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='api_cache1'
      ORDER BY ordinal_position;
    `);

    res.json({ ok: true, before: before.rows, after: after.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

/* =========================
   API endpoints
   ========================= */

app.get("/api/competitions", async (_req, res) => {
  try {
    const cacheKey = "fd:v4:competitions";
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json({ source: "cache", data: cached });

    const data = await fdGet("/competitions");

    // cache 24h
    await cacheSet(cacheKey, data, 24 * 60 * 60);

    res.json({ source: "live", data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load competitions" });
  }
});

app.get("/api/competitions/top", async (_req, res) => {
  try {
    const cacheKey = "fd:v4:competitions";
    let cached = await cacheGet(cacheKey);

    let data;
    if (cached) {
      data = cached;
    } else {
      data = await fdGet("/competitions");
      // cache 24h anche qui, così top è sempre veloce
      await cacheSet(cacheKey, data, 24 * 60 * 60);
    }

    const filtered = (data.competitions ?? []).filter((c) =>
      TOP_COMPETITIONS.includes(c.code)
    );

    res.json({
      source: cached ? "cache" : "live",
      competitions: filtered.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        area: c.area?.name ?? null,
        emblem: c.emblem ?? null,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load top competitions" });
  }
});

app.get("/api/competitions/:code/standings", async (req, res) => {
  try {
    const code = String(req.params.code || "").toUpperCase();

    const allowed = ["PL", "PD", "SA", "BL1", "FL1", "CL"];
    if (!allowed.includes(code)) {
      return res.status(400).json({ error: "Unsupported competition code" });
    }

    const cacheKey = `fd:v4:standings:${code}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json({ source: "cache", data: cached });

    const data = await fdGet(`/competitions/${code}/standings`);

    // cache 30 minutes
    await cacheSet(cacheKey, data, 30 * 60);

    res.json({ source: "live", data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load standings" });
  }
});

/* =========================
   DEBUG endpoints (temporanei)
   ========================= */

app.get("/api/cache-check", async (_req, res) => {
  try {
    const key = "fd:v4:standings:SA";
    const cached = await cacheGet(key);
    res.json({ key, found: Boolean(cached) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/api/db-test-write", async (_req, res) => {
  try {
    const key = "test:key";
    await cacheSet(key, { hello: "world", t: Date.now() }, 60 * 60);
    res.json({ ok: true, wrote: key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.get("/api/db-test-read", async (_req, res) => {
  try {
    const key = "test:key";
    const cached = await cacheGet(key);
    res.json({ ok: true, key, value: cached });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.get("/api/db-inspect", async (_req, res) => {
  try {
    const key = "test:key";
    const { rows } = await pool.query(
      `SELECT cache_key, payload_json, expires_at, created_at, NOW() as now
       FROM api_cache1
       WHERE cache_key = $1
       LIMIT 1`,
      [key]
    );

    res.json({ found: rows.length > 0, row: rows[0] ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API running on port ${port}`));
