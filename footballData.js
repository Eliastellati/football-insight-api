const BASE = "https://api.football-data.org/v4";

function token() {
  if (!process.env.FOOTBALL_DATA_TOKEN) {
    throw new Error("Missing FOOTBALL_DATA_TOKEN env var");
  }
  return process.env.FOOTBALL_DATA_TOKEN;
}

export async function fdGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Auth-Token": token() },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`football-data error ${res.status}: ${text}`);
  }

  return res.json();
}
