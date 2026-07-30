import cookie from "cookie";
import { query } from "../../db.js";

const TTL_HOURS = 24;

export default async function handler(req, res) {
  const challengeId = req.query.id;

  if (!challengeId) {
    return res.status(400).json({ error: "Missing challenge id" });
  }

	// pour refresh manuel
  const force = req.query.force === "1";

  // Lire strava_token
  const cookies = cookie.parse(req.headers.cookie || "");
  const token = cookies.strava_token;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    //
    // 1. Vérifier si un leaderboard existe déjà en BD
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

      // Si le leaderboard a moins de 24h → on renvoie le cache
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
    // 3. Appeler Strava pour chaque segment (1 appel / segment)
    //
    const segmentLeaderboards = [];

    for (const segId of segmentIds) {
      const lbRes = await fetch(
        `https://www.strava.com/api/v3/segments/${segId}/leaderboard`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const lbData = await lbRes.json();

      if (lbData.entries) {
        segmentLeaderboards.push(lbData.entries);
      }
    }

    //
    // 4. Fusionner les temps par athlète
    //
    const totals = {}; // athlete_id → { name, total_seconds }

    for (const lb of segmentLeaderboards) {
      for (const entry of lb) {
        const id = entry.athlete_id;
        const name = entry.athlete_name;
        const time = entry.elapsed_time;

        if (!totals[id]) {
          totals[id] = { name, total_seconds: 0 };
        }

        totals[id].total_seconds += time;
      }
    }

    //
    // 5. Convertir en tableau et trier
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
    // 6. Stocker le leaderboard en BD (upsert)
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
