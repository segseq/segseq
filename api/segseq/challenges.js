import { query } from "../../db.js";
// import cookie from "cookie";


export default async function handler(req, res) {
  //debug
  console.log("REQ BODY:", req.body);
  console.log("REQ COOKIES RAW:", req.headers.cookie);
  console.log("PARSED COOKIES:", cookie.parse(req.headers.cookie || ""));
  
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, description, sport, duration, segments } = req.body;

  // Validation simple
  if (!name || !sport || !duration || !Array.isArray(segments) || segments.length < 2) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    // récupérer l'athlete_id Strava depuis ton cookie/token
	//const cookies = cookie.parse(req.headers.cookie || "");
	//const creatorId = cookies.athlete_id;
const creatorId = 10605349;
if (!creatorId) {
return res.status(401).json({ error: "Not authenticated" });
}


    // 1. Insérer le challenge
    const rows = await query(
		if (!creatorId) {
	console.error("Missing athlete_id cookie");
	return res.status(401).json({ error: "Not authenticated" });
	}
	
      `INSERT INTO challenges (creator_id, name, description, sport, duration_hours)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [creatorId, name, description, sport, duration]
    );

    const challengeId = rows[0].id;

    // 2. Insérer les segments
    for (let i = 0; i < segments.length; i++) {
      const segId = segments[i];
      await query(
        `INSERT INTO challenge_segments (challenge_id, segment_id, order_index)
         VALUES ($1, $2, $3)`,
        [challengeId, segId, i + 1]
      );
    }

    return res.status(200).json({ id: challengeId });
  } catch (err) {
    console.error("DB error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
