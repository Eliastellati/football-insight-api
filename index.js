import { cacheGet, cacheSet } from "./cache.js";
import { fdGet } from "./footballData.js";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";



dotenv.config();

const app = express();
app.set("trust proxy", 1);
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

app.get("/health", (_req, res) => res.json({ ok: true }));

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
import { TOP_COMPETITIONS } from "./config.js";

app.get("/api/competitions/top", async (_req, res) => {
  try {
    const cacheKey = "fd:v4:competitions";
    const cached = await cacheGet(cacheKey);
    const data = cached ?? (await fdGet("/competitions"));

    // Filter only curated codes
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

    // basic validation
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

app.get("/api/cache-check", async (_req, res) => {
  try {
    const key = "fd:v4:standings:SA";
    const cached = await cacheGet(key);
    const found = Boolean(cached);
    res.json({ key, found });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/db-test-write", async (_req, res) => {
  try {
    const key = "test:key";
    await cacheSet(key, { hello: "world", t: Date.now() }, 60 * 60);
    res.json({ ok: true, wrote: key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get("/api/db-test-read", async (_req, res) => {
  try {
    const key = "test:key";
    const cached = await cacheGet(key);
    res.json({ ok: true, key, value: cached });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

import { pool } from "./db.js";

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
    res.status(500).json({ error: String(err.message || err) });
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API running on port ${port}`));
