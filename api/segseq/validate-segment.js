import { query } from "../../db.js";

export default async function handler(req, res) {
  const segmentId = req.query.id;
  if (!segmentId) return res.status(400).json({ error: "Missing segment ID" });

  try {
    // 1. Prendre un athlète au hasard qui a un token pour faire la requête
    const athletes = await query(`SELECT id, access_token, refresh_token, expires_at FROM athletes WHERE access_token IS NOT NULL LIMIT 1`);
    if (athletes.length === 0) return res.status(500).json({ error: "Aucun compte Strava lié à l'application." });
    
    let athlete = athletes[0];
    const nowUnix = Math.floor(Date.now() / 1000);

    // 2. Rafraîchir le token s'il est expiré
    if (athlete.expires_at < nowUnix) {
      const tokenRes = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.STRAVA_CLIENT_ID,
          client_secret: process.env.STRAVA_CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: athlete.refresh_token
        })
      });

      if (tokenRes.ok) {
        const newTokens = await tokenRes.json();
        await query(`UPDATE athletes SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE id = $4`, 
          [newTokens.access_token, newTokens.refresh_token, newTokens.expires_at, athlete.id]);
        athlete.access_token = newTokens.access_token;
      } else {
        return res.status(500).json({ error: "Erreur d'authentification Strava." });
      }
    }

    // 3. Interroger Strava avec un token valide
    const stravaRes = await fetch(`https://www.strava.com/api/v3/segments/${segmentId}`, {
      headers: { Authorization: `Bearer ${athlete.access_token}` }
    });

    if (!stravaRes.ok) return res.status(404).json({ error: "Segment introuvable ou privé." });

    const data = await stravaRes.json();
    return res.status(200).json({ name: data.name, distance: data.distance });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}