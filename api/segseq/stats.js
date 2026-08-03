import { query } from "../../db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Compter le nombre total d'athlètes
    const athletesRes = await query(`SELECT COUNT(*) as total FROM athletes`);
    
    // Compter le nombre total de challenges
    const challengesRes = await query(`SELECT COUNT(*) as total FROM challenges`);

    return res.status(200).json({
      athletes: parseInt(athletesRes[0].total, 10),
      challenges: parseInt(challengesRes[0].total, 10)
    });
  } catch (err) {
    console.error("Stats DB error:", err);
    return res.status(500).json({ error: "Failed to load stats" });
  }
}