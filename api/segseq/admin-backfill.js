import { query } from "../../db.js";
import { calculateLeaderboard } from "./leaderboard.js"; 

const delay = (ms) => new Promise(res => setTimeout(res, ms));

export default async function handler(req, res) {
  const athleteId = req.query.athlete_id;
  
  if (!athleteId) {
    return res.status(400).json({ error: "Veuillez fournir un athlete_id dans l'URL." });
  }

  try {
    // 1. Récupérer l'athlète
    const athletes = await query(`SELECT * FROM athletes WHERE id = $1`, [athleteId]);
    if (athletes.length === 0) return res.status(404).json({ error: "Athlète introuvable en base de données." });
    
    let athlete = athletes[0];
    const athleteName = `${athlete.firstname || ''} ${athlete.lastname || ''}`.trim();

    // 2. Vérifier et rafraîchir le token Strava si nécessaire
    const nowUnix = Math.floor(Date.now() / 1000);
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
        return res.status(500).json({ error: "Impossible de rafraîchir le token Strava de cet athlète." });
      }
    }

    // 3. Récupérer TOUS les segments uniques liés à des défis
    const segmentsDb = await query(`SELECT DISTINCT segment_id FROM challenge_segments`);
    let totalInserted = 0;

    // 4. Backfill Strava pour cet athlète
    for (const row of segmentsDb) {
      const stravaRes = await fetch(`https://www.strava.com/api/v3/segment_efforts?segment_id=${row.segment_id}&per_page=200`, {
        headers: { Authorization: `Bearer ${athlete.access_token}` }
      });

      if (stravaRes.ok) {
        const efforts = await stravaRes.json();
        for (const effort of efforts) {
          const resDb = await query(`
            INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (effort_id) DO NOTHING RETURNING id
          `, [effort.id, row.segment_id, athlete.id, athleteName, effort.start_date_local || effort.start_date, effort.elapsed_time]);
          
          if (resDb.length > 0) totalInserted++;
        }
      }
      await delay(200); // Respect strict du Rate Limit Strava
    }

    // 5. Recalculer TOUS les classements
    const allChallenges = await query(`SELECT id FROM challenges`);
    const allAthletes = await query(`SELECT id, firstname, lastname, profile, sex FROM athletes`);

    for (const challenge of allChallenges) {
      // On passe une fonction vide () => {} pour ne pas polluer les logs
      await calculateLeaderboard(challenge.id, allAthletes, () => {}); 
    }

    return res.status(200).json({ 
      success: true, 
      message: `Backfill terminé avec succès pour ${athleteName}.`,
      efforts_inseres: totalInserted,
      classements_mis_a_jour: allChallenges.length
    });

  } catch (error) {
    console.error("Erreur Admin Backfill:", error);
    return res.status(500).json({ error: error.message });
  }
}