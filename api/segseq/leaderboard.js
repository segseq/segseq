import { query } from "../../db.js";

// TTL du cache en heures
const TTL_HOURS = 24;

// Parseur cookie maison (évite les problèmes ESM/CJS)
function parseCookie(header = "") {
  const out = {};
  header.split(";").forEach(part => {
    const [k, v] = part.split("=").map(s => s && s.trim());
    if (k) out[k] = v || "";
  });
  return out;
}

export default async function handler(req, res) {
  const challengeId = req.query.id;
  const force = req.query.force === "1";

  if (!challengeId) {
    return res.status(400).json({ error: "Missing challenge id" });
  }

  // Lire le cookie Strava
  const cookies = parseCookie(req.headers.cookie || "");
  const token = cookies.strava_token;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    //
    // 1. Vérifier si un leaderboard existe déjà
    //
    const existing = await query(
      `SELECT data, updated_at
       FROM leaderboards
       WHERE challenge_id = $1`,
      [challengeId]
    );

    if (!force && existing.length > 0) {
      const updatedAt = new Date(existing[0].updated_at);
      const ageHours = (Date.now() - updatedAt.getTime()) / 1000 / 3600;

      if (ageHours < TTL_HOURS) {
        return res.status(200).json(existing[0].data);
      }
    }

    //
    // 2. Récupérer les segments du challenge
    //
    const segments = await query(
      `SELECT segment_id
       FROM challenge_segments
       WHERE challenge_id = $1
       ORDER BY order_index ASC`,
      [challengeId]
    );

    const segmentIds = segments.map(s => s.segment_id);

    //
    // 3. Appeler Strava pour chaque segment → /all_efforts
    //
    const segmentEfforts = [];

    for (const segId of segmentIds) {
      const effortsRes = await fetch(
        `https://www.strava.com/api/v3/segments/${segId}/all_efforts`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const text = await effortsRes.text();

      let efforts;
      try {
        efforts = JSON.parse(text);
      } catch (e) {
        console.error("Strava returned non‑JSON:", text);
        continue;
      }

      if (Array.isArray(efforts)) {
        segmentEfforts.push(efforts);
      }
    }

    //
    // 4. Fusionner les temps par athlète
    //
    const totals = {}; // athlete_id → { name, total_seconds }

    for (const effortList of segmentEfforts) {
      for (const effort of effortList) {
        const athleteId = effort.athlete.id;
        const name = effort.athlete.name;
        const time = effort.elapsed_time;

        if (!totals[athleteId]) {
          totals[athleteId] = { name, total_seconds: 0 };
        }

        totals[athleteId].total_seconds += time;
      }
    }

    //
    // 5. Convertir en tableau + trier
    //
    const leaderboard = Object.entries(totals)
      .map(([athlete_id, data]) => ({
        athlete_id,
        athlete: data.name,
        time_seconds: data.total_seconds,
        time_human: formatTime(data.total_seconds)
      }))
      .sort((a, b) => a.time_seconds - b.time_seconds)
      .map((row, index) => ({
        rank: index + 1,
        ...row
      }));

    const finalData = { leaderboard };

    //
    // 6. Stocker en BD (upsert)
    //
    await query(
      `INSERT INTO leaderboards (challenge_id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (challenge_id)
       DO UPDATE SET data = $2, updated_at = NOW()`,
      [challengeId, finalData]
    );

    //
    // 7. Retourner le leaderboard
    //
    return res.status(200).json(finalData);

  } catch (err) {
    console.error("Leaderboard error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}
