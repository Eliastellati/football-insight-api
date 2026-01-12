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


const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API running on port ${port}`));
