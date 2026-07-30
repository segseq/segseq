import { query } from "../../db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const id = req.query.id;

  if (!id) {
    return res.status(400).json({ error: "Missing id" });
  }

  try {
    // 1. Récupérer le challenge
    const challengeRows = await query(
      `SELECT id, creator_id, name, description, sport, duration_hours
       FROM challenges
       WHERE id = $1`,
      [id]
    );

    if (challengeRows.length === 0) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const challenge = challengeRows[0];

    // 2. Récupérer les segments
    const segmentRows = await query(
      `SELECT segment_id, order_index
       FROM challenge_segments
       WHERE challenge_id = $1
       ORDER BY order_index ASC`,
      [id]
    );

    // 3. Leaderboard fictif pour l'instant
    const leaderboard = [
      { rank: 1, athlete: "Alex Tremblay", time: "14h 22m" },
      { rank: 2, athlete: "Marie Gagnon", time: "15h 10m" },
      { rank: 3, athlete: "Samuel Roy", time: "16h 05m" }
    ];

    return res.status(200).json({
      id: challenge.id,
      name: challenge.name,
      description: challenge.description,
      sport: challenge.sport,
      duration: challenge.duration_hours,
      segments: segmentRows.map(s => ({
        id: s.segment_id,
        order: s.order_index
      })),
      leaderboard
    });

  } catch (err) {
    console.error("DB error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
