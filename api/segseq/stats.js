import { query } from "../../db.js";
import { parse } from "cookie-es";
import jwt from "jsonwebtoken";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const scope = req.query.scope;

  try {
    // --- CAS 1 : STATISTIQUES PERSONNELLES (Profil) ---
    if (scope === "me") {
      const cookies = parse(req.headers.cookie || "");
      const sessionToken = cookies.session;

      if (!sessionToken) return res.status(401).json({ error: "Non authentifié" });

      const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
      const athleteId = decoded.athleteId;

      const createdRes = await query(`SELECT COUNT(*) as count FROM challenges WHERE creator_id = $1`, [athleteId]);
      const completedRes = await query(`SELECT COUNT(DISTINCT challenge_id) as count FROM challenge_results WHERE athlete_id = $1`, [athleteId]);
      const effortsRes = await query(`SELECT COUNT(*) as count FROM segment_efforts WHERE athlete_id = $1`, [athleteId]);
	  const victoriesRes = await query(`SELECT COUNT(*) as count FROM challenge_results WHERE athlete_id = $1 AND rank = 1`, [athleteId]);

      return res.status(200).json({
        created: parseInt(createdRes[0].count, 10),
        completed: parseInt(completedRes[0].count, 10),
        efforts: parseInt(effortsRes[0].count, 10)
		victories: parseInt(victoriesRes[0].count, 10),
      });
    } 
    
    // --- CAS 2 : STATISTIQUES GLOBALES (Explore) ---
    else {
      const athletesRes = await query(`SELECT COUNT(*) as count FROM athletes`);
      const challengesRes = await query(`SELECT COUNT(*) as count FROM challenges`);

      return res.status(200).json({
        athletes: parseInt(athletesRes[0].count, 10),
        challenges: parseInt(challengesRes[0].count, 10)
      });
    }

  } catch (err) {
    console.error("Erreur stats:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}