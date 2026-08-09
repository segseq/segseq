import { query } from "../../db.js";
import { calculateLeaderboard } from "./leaderboard.js"; 

const delay = (ms) => new Promise(res => setTimeout(res, ms));

export default async function handler(req, res) {
  const athleteId = req.query.athlete_id;
  let debugLog = []; // Notre journal de bord Rayon-X
  
  if (!athleteId) return res.status(400).json({ error: "Veuillez fournir un athlete_id" });

  try {
    const athletes = await query(`SELECT * FROM athletes WHERE id = $1`, [athleteId]);
    if (athletes.length === 0) return res.status(404).json({ error: "Athlète introuvable" });
    
    let athlete = athletes[0];
    const athleteName = `${athlete.firstname || ''} ${athlete.lastname || ''}`.trim();
    debugLog.push(`Athlète trouvé: ${athleteName}`);

    // Vérification du Token
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
        debugLog.push("Token rafraîchi avec succès.");
      } else {
        debugLog.push("❌ Échec du rafraîchissement du token.");
      }
    } else {
      debugLog.push("Token toujours valide.");
    }

    const segmentsDb = await query(`SELECT DISTINCT segment_id FROM challenge_segments`);
    debugLog.push(`${segmentsDb.length} segments uniques trouvés en base.`);

    let totalInserted = 0;

    // Interrogation de Strava
    for (const row of segmentsDb) {
      const stravaRes = await fetch(`https://www.strava.com/api/v3/segment_efforts?segment_id=${row.segment_id}&per_page=200`, {
        headers: { Authorization: `Bearer ${athlete.access_token}` }
      });

      if (!stravaRes.ok) {
        const errText = await stravaRes.text();
        debugLog.push(`❌ Erreur Strava (Seg ${row.segment_id}): ${stravaRes.status} - ${errText}`);
        continue;
      }

      const efforts = await stravaRes.json();
      debugLog.push(`Seg ${row.segment_id} : Strava a renvoyé ${efforts.length} efforts.`);

      for (const effort of efforts) {
        try {
          // Utilisation de effort_id comme conflit principal
          const resDb = await query(`
            INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (effort_id) DO UPDATE SET athlete_id = EXCLUDED.athlete_id
            RETURNING id
          `, [effort.id, row.segment_id, athlete.id, athleteName, effort.start_date_local || effort.start_date, effort.elapsed_time]);
          
          if (resDb && resDb.length > 0) totalInserted++;
        } catch (sqlErr) {
          debugLog.push(`❌ Erreur SQL (Effort ${effort.id}): ${sqlErr.message}`);
        }
      }
      await delay(200); 
    }

    debugLog.push(`Total efforts insérés ou mis à jour: ${totalInserted}`);

    // Recalcul des classements
    const allChallenges = await query(`SELECT id FROM challenges`);
    const allAthletes = await query(`SELECT id, firstname, lastname, profile, sex FROM athletes`);
    for (const challenge of allChallenges) {
      await calculateLeaderboard(challenge.id, allAthletes, () => {}); 
    }
    debugLog.push(`Classements recalculés: ${allChallenges.length}`);

    return res.status(200).json({ success: true, debug: debugLog });

  } catch (error) {
    debugLog.push(`❌ Erreur Fatale: ${error.message}`);
    return res.status(500).json({ error: error.message, debug: debugLog });
  }
}