import { query } from "../../db.js";
import { calculateLeaderboard } from "./leaderboard.js"; 

const delay = (ms) => new Promise(res => setTimeout(res, ms));

export default async function handler(req, res) {
  const athleteId = req.query.athlete_id;
  let debugLog = [];
  
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
        debugLog.push("Token rafraîchi.");
      } else {
        return res.status(500).json({ error: "Échec rafraîchissement token." });
      }
    }

    // 1. On récupère tous les segments de l'application dans un Set pour une recherche ultra-rapide
    const segmentsDb = await query(`SELECT DISTINCT segment_id FROM challenge_segments`);
    const activeSegIds = new Set(segmentsDb.map(s => s.segment_id.toString()));
    debugLog.push(`${activeSegIds.size} segments cibles trouvés en base.`);

    let totalInserted = 0;

    // 2. STRATÉGIE ANTI-PAYWALL : On récupère les 50 dernières activités de l'athlète
    debugLog.push("Récupération des 50 dernières activités (Bypass Paywall Strava)...");
    const activitiesRes = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=200`, {
      headers: { Authorization: `Bearer ${athlete.access_token}` }
    });

    if (!activitiesRes.ok) throw new Error("Impossible de lire les activités.");
    const activities = await activitiesRes.json();
    debugLog.push(`${activities.length} activités trouvées. Analyse en cours...`);

    // 3. On analyse chaque activité en détail pour extraire les segments
    for (const act of activities) {
      // Pour avoir les segments, il faut requêter l'activité en détail
      const detailRes = await fetch(`https://www.strava.com/api/v3/activities/${act.id}?include_all_efforts=true`, {
        headers: { Authorization: `Bearer ${athlete.access_token}` }
      });
      
      if (detailRes.ok) {
        const detail = await detailRes.json();
        if (detail.segment_efforts) {
          for (const effort of detail.segment_efforts) {
            // Si l'effort correspond à un segment de nos défis
            if (activeSegIds.has(effort.segment.id.toString())) {
              try {
                const resDb = await query(`
                  INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time)
                  VALUES ($1, $2, $3, $4, $5, $6)
                  ON CONFLICT (segment_id, athlete_name, start_date) 
                  DO UPDATE SET effort_id = EXCLUDED.effort_id, athlete_id = EXCLUDED.athlete_id
                  RETURNING id
                `, [effort.id, effort.segment.id, athlete.id, athleteName, effort.start_date_local || effort.start_date, effort.elapsed_time]);
                
                if (resDb && resDb.length > 0) totalInserted++;
              } catch (sqlErr) {
                console.error("Erreur SQL:", sqlErr);
              }
            }
          }
        }
      }
      await delay(250); // Respect du Rate Limit Strava (Très important ici)
    }

    debugLog.push(`Total efforts récupérés et insérés: ${totalInserted}`);

    // 4. Recalcul des classements
    const allChallenges = await query(`SELECT id FROM challenges`);
    const allAthletes = await query(`SELECT id, firstname, lastname, profile, sex FROM athletes`);
    for (const challenge of allChallenges) {
      await calculateLeaderboard(challenge.id, allAthletes, () => {}); 
    }
    debugLog.push(`Classements recalculés: ${allChallenges.length}`);

    return res.status(200).json({ success: true, debug: debugLog });

  } catch (error) {
    debugLog.push(`❌ Erreur: ${error.message}`);
    return res.status(500).json({ error: error.message, debug: debugLog });
  }
}