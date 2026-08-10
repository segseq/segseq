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

debugLog.push("Début de la stratégie de backfill 'segment-centric'.");

// Récupérer tous les segments uniques de l'application
  const allAppSegments = await query(`SELECT DISTINCT segment_id FROM challenge_segments`);
  const allAppSegmentIds = new Set(allAppSegments.map(s => s.segment_id.toString()));
  debugLog.push(`${allAppSegmentIds.size} segments uniques à vérifier dans l'application.`);

  let totalInserted = 0;

  if (athlete.premium) {
    // --- Stratégie PREMIUM: Backfill complet et rapide ---
    debugLog.push(`Statut: Compte Premium. Utilisation de la méthode de backfill direct (getSegmentEfforts).`);

    for (const segmentId of allAppSegmentIds) {
      try {
        const effortsRes = await fetch(`https://www.strava.com/api/v3/segment_efforts?segment_id=${segmentId}&athlete_id=${athlete.id}`, {
          headers: { Authorization: `Bearer ${athlete.access_token}` }
        });

        if (effortsRes.ok) {
          const efforts = await effortsRes.json();
          if (efforts.length > 0) {
            debugLog.push(`-> Trouvé ${efforts.length} effort(s) pour le segment ${segmentId}.`);
            for (const effort of efforts) {
              const resDb = await query(`
                INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time)
                VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (effort_id) DO NOTHING RETURNING id`,
                [effort.id, effort.segment.id, athlete.id, athleteName, effort.start_date_local || effort.start_date, effort.elapsed_time]
              );
              if (resDb && resDb.length > 0) totalInserted++;
            }
          }
        } else {
          debugLog.push(`X Erreur API pour le segment ${segmentId}: ${effortsRes.statusText}`);
          if (effortsRes.status === 429) {
            debugLog.push(`! Limite de l'API Strava atteinte. Le backfill s'arrête.`);
            break;
          }
        }
        await delay(250); // Respecter la limite de l'API
      } catch (err) {
        debugLog.push(`X Erreur critique sur le backfill du segment ${segmentId}.`);
      }
    }
  } else {
    // --- Stratégie GRATUIT (Contournement): Backfill via les activités récentes ---
    debugLog.push(`Statut: Compte Gratuit. Utilisation de la méthode de contournement (getActivities).`);
    debugLog.push(`Note: Strava limite l'accès aux 200 dernières activités pour les comptes gratuits.`);

    try {
      // On ne récupère que la première page (200 activités max)
      const activitiesRes = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1`, {
        headers: { Authorization: `Bearer ${athlete.access_token}` }
      });

      if (activitiesRes.ok) {
        const activities = await activitiesRes.json();
        debugLog.push(`-> Trouvé ${activities.length} activités récentes à analyser.`);

        for (const activity of activities) {
          // L'API /activities ne renvoie pas les efforts par défaut. Il faut appeler l'activité individuelle.
          // C'est plus d'appels, mais toujours mieux que de scanner tous les segments.
          const activityDetailRes = await fetch(`https://www.strava.com/api/v3/activities/${activity.id}?include_all_efforts=true`, {
             headers: { Authorization: `Bearer ${athlete.access_token}` }
          });
          
          if(activityDetailRes.ok) {
            const activityDetail = await activityDetailRes.json();
            if (activityDetail.segment_efforts && activityDetail.segment_efforts.length > 0) {
              for (const effort of activityDetail.segment_efforts) {
                // On insère seulement si le segment fait partie de notre application
                if (allAppSegmentIds.has(effort.segment.id.toString())) {
                  const resDb = await query(`
                    INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time)
                    VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (effort_id) DO NOTHING RETURNING id`,
                    [effort.id, effort.segment.id, athlete.id, athleteName, effort.start_date_local || effort.start_date, effort.elapsed_time]
                  );
                  if (resDb && resDb.length > 0) totalInserted++;
                }
              }
            }
          }
          await delay(300); // Délai entre chaque appel d'activité détaillée
        }
      } else {
        debugLog.push(`X Erreur API lors de la récupération des activités: ${activitiesRes.statusText}`);
      }
    } catch (err) {
      debugLog.push(`X Erreur critique lors du backfill des activités.`);
    }
  }

  debugLog.push(`Total efforts récupérés et insérés : ${totalInserted}`);


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