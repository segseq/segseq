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

debugLog.push("Début de la nouvelle stratégie de backfill 'segment-centric'.");

// 1. Récupérer TOUS les segments uniques de TOUS les challenges de l'application
const allAppSegments = await query(`SELECT DISTINCT segment_id FROM challenge_segments`);
const allAppSegmentIds = allAppSegments.map(s => s.segment_id);
debugLog.push(`${allAppSegmentIds.length} segments uniques à vérifier dans l'application.`);

let totalInserted = 0;

// 2. Pour chaque segment, récupérer les efforts de l'athlète
for (const segmentId of allAppSegmentIds) {
    try {
        // Cet endpoint fonctionne avec le scope 'read' de base.
        const effortsRes = await fetch(`https://www.strava.com/api/v3/segment_efforts?segment_id=${segmentId}&athlete_id=${athlete.id}`, {
            headers: { Authorization: `Bearer ${athlete.access_token}` }
        });

        if (effortsRes.ok) {
            const efforts = await effortsRes.json();
            if (efforts.length > 0) {
                debugLog.push(`-> Trouvé ${efforts.length} effort(s) pour le segment ${segmentId}.`);

                // 3. Insérer chaque effort dans la base de données
                for (const effort of efforts) {
                    // On vérifie que l'activité n'est pas privée si l'utilisateur n'a donné que l'accès public
                    const athleteScope = athlete.scope || '';
                    if (!athleteScope.includes('activity:read_all') && effort.activity.private) {
                        continue; // On ignore cet effort car il provient d'une activité privée non autorisée
                    }

                    const resDb = await query(`
                        INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (effort_id) DO NOTHING
                        RETURNING id`,
                        [effort.id, effort.segment.id, athlete.id, athleteName, effort.start_date_local || effort.start_date, effort.elapsed_time]
                    );
                    if (resDb && resDb.length > 0) {
                        totalInserted++;
                    }
                }
            }
        } else {
            // Gérer les erreurs, par ex. 429 (Rate Limit)
            debugLog.push(`X Erreur API pour le segment ${segmentId}: ${effortsRes.statusText}`);
            if (effortsRes.status === 429) {
                 debugLog.push(`! Limite de l'API Strava atteinte. Le backfill s'arrête pour cet athlète.`);
                 break; // Sortir de la boucle des segments
            }
        }
        
        // Respecter la limite de l'API Strava
        await delay(250); 

    } catch (err) {
        console.error(`Erreur critique sur le backfill du segment ${segmentId}:`, err);
        debugLog.push(`X Erreur critique sur le backfill du segment ${segmentId}.`);
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