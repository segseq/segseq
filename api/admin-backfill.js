/* admin-backfill.js */

import { query } from "../db.js";
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

    // 2. STRATÉGIE ANTI-PAYWALL & PREMIUM
        debugLog.push("Vérification du statut de l'athlète...");
        const profileRes = await fetch("https://www.strava.com/api/v3/athlete", {
            headers: { Authorization: `Bearer ${athlete.access_token}` }
        });
        const profileData = await profileRes.json();
        const isPremium = profileData.premium === true;

        debugLog.push(`Statut : ${isPremium ? 'Premium (Historique complet)' : 'Gratuit (Max 200 activités)'}`);

        let allActivities = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            debugLog.push(`Récupération des activités (Page ${page})...`);
            const activitiesRes = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`, {
                headers: { Authorization: `Bearer ${athlete.access_token}` }
            });

            if (!activitiesRes.ok) throw new Error("Impossible de lire les activités.");
            const activities = await activitiesRes.json();
            allActivities = allActivities.concat(activities);

            // Si gratuit, on s'arrête à la page 1. Si Premium, on continue tant que la page est pleine (200).
            if (!isPremium) {
                hasMore = false;
            } else {
                if (activities.length === 200) {
                    page++;
                } else {
                    hasMore = false;
                }
            }
        }

        debugLog.push(`${allActivities.length} activités trouvées. Analyse en cours...`);




    // 3. On extrait chaque effort qui contient un segment actif dans un défi
for (const segId of activeSegIds) {
    try {
        // 1 seul appel API par segment pour récupérer jusqu'à 200 efforts de l'athlète
        const stravaUrl = `https://www.strava.com/api/v3/segment_efforts?segment_id=${segId}&per_page=200`;
        const res = await fetch(stravaUrl, { 
            headers: { Authorization: `Bearer ${athlete.access_token}` } 
        });

        if (res.ok) {
            const efforts = await res.json();
            for (const effort of efforts) {
                // Insérer dans la base de données (ON CONFLICT DO NOTHING)
                await query(`
                    INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time)
                    VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (effort_id) DO NOTHING
                `, [effort.id, segId, athlete.id, athleteName, effort.start_date_local, effort.elapsed_time]);
            }
        }
        await delay(300); // Pause de 300ms = max ~50 requêtes par minute. Très sécuritaire.
    } catch (err) {
        console.error(`Erreur sur le segment ${segId}:`, err);
    }
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