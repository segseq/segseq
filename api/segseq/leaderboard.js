import cookie from "cookie";
import { query } from "../../db.js";

export default async function handler(req, res) {
  const challengeId = req.query.id;

  if (!challengeId) {
    return res.status(400).json({ error: "Missing challenge id" });
  }

  // Lire strava_token
  const cookies = cookie.parse(req.headers.cookie || "");
  const token = cookies.strava_token;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    // 1. Récupérer les segments du challenge
    const segments = await query(
      `SELECT segment_id, order_index
       FROM challenge_segments
       WHERE challenge_id = $1
       ORDER BY order_index ASC`,
      [challengeId]
    );

    const segmentIds = segments.map(s => s.segment_id);

    // 2. Récupérer le leaderboard Strava pour chaque segment
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

    // 3. Fusionner les temps par athlète
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

    // 4. Convertir en tableau et trier
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

    return res.status(200).json({ leaderboard });

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
