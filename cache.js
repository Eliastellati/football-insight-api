import { pool } from "./db.js";

export async function cacheGet(cacheKey) {
  const { rows } = await pool.query(
    `SELECT payload_json
     FROM api_cache
     WHERE cache_key = $1 AND expires_at > NOW()
     LIMIT 1`,
    [cacheKey]
  );
  return rows[0]?.payload_json ?? null;
}

export async function cacheSet(cacheKey, payload, ttlSeconds) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await pool.query(
    `INSERT INTO api_cache (cache_key, payload_json, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (cache_key)
     DO UPDATE SET payload_json = EXCLUDED.payload_json, expires_at = EXCLUDED.expires_at`,
    [cacheKey, payload, expiresAt]
  );
}
