/* ------------------------------ */
/* ./api/webhook.js */
/* ------------------------------ */

import { query } from "../db.js";
import { calculateLeaderboard } from "./leaderboard.js";
import { parse } from "cookie-es";
import jwt from 'jsonwebtoken';


const VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN || "segseq_secure_webhook_123";
const JWT_SECRET = process.env.JWT_SECRET; // Ajout pour vérifier l'auth


export default async function handler(req, res) {
    // --- Routes API pour le Frontend (Notifications) ---
    // Ces routes sont indépendantes du webhook Strava
  const { action } = req.query;

  if (req.method === 'GET' && action === 'getNotifications') {
    try {
      const cookies = parse(req.headers.cookie || '');
      if (!cookies.session) return res.status(401).json({ error: 'Unauthorized' });
      
      const decoded = jwt.verify(cookies.session, JWT_SECRET);
      const notifs = await query('SELECT * FROM notifications WHERE athlete_id = $1 ORDER BY created_at DESC LIMIT 20', [decoded.athleteid]);
      return res.status(200).json(notifs);
    } catch (e) {
      console.error("Auth error for getNotifications:", e);
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  if (req.method === 'POST' && action === 'markNotificationsRead') {
    try {
      const cookies = parse(req.headers.cookie || '');
      if (!cookies.session) return res.status(401).json({ error: 'Unauthorized' });
      
      const decoded = jwt.verify(cookies.session, JWT_SECRET);
      await query('UPDATE notifications SET is_read = true WHERE athlete_id = $1', [decoded.athleteid]);
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error("Auth error for markNotificationsRead:", e);
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  // -------------------------------------------------------------

  // --- LOGIQUE ORIGINALE STRAVA WEBHOOK ---
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WEBHOOK VERIFIED BY STRAVA');
        // Retourne le challenge pour confirmer la vérification
        return res.status(200).json({ "hub.challenge": challenge });
      } else {
        console.log('Webhook verification failed: Invalid token or mode.');
        return res.status(403).send('Forbidden');
      }
    }
    console.log('Webhook GET request missing mode or token.');
    return res.status(400).send('Bad Request');
  } 
  else if (req.method === 'POST') {
    const event = req.body;
    
    // --- CORRECTION MAJEURE : Suppression du bloc dupliqué et inatteignable ---
    // Le traitement de l'activité doit avoir lieu AVANT l'envoi de la réponse à Strava.
    if (event.object_type === 'activity' && event.aspect_type === 'create') {
        try {
            // Appel à processActivity pour traiter l'événement
            await processActivity(event.owner_id, event.object_id);
        } catch (err) {
            // Log l'erreur pour investigation, mais ne pas renvoyer d'erreur 500 à Strava
            // pour éviter des boucles de réessai infinies.
            console.error(`Webhook POST error processing activity ${event.object_id} for athlete ${event.owner_id}:`, err);
        }
    } else {
        console.log(`Webhook POST received event type: ${event.object_type}, aspect: ${event.aspect_type}. Ignored.`);
    }

    // Accuse réception immédiate de l'événement à Strava.
    res.status(200).send('EVENT_RECEIVED'); 
  } else {
    console.log(`Webhook received unsupported method: ${req.method}`);
    res.status(405).send('Method Not Allowed');
  }
}


async function processActivity(athleteId, activityId) {
    // Fetch athlete details
    const athletes = await query(`SELECT firstname, lastname, access_token, refresh_token, expires_at, scope, restricted_challenge_ids FROM athletes WHERE id = $1`, [athleteId]);
    if (athletes.length === 0) {
        console.log(`Webhook: Athlete ${athleteId} not found. Cannot process activity ${activityId}.`);
        return;
    }
    let athlete = athletes[0];
    const athleteName = `${athlete.firstname} ${athlete.lastname}`.trim();

    // Token refresh logic
    const nowUnix = Math.floor(Date.now() / 1000);
    if (athlete.expires_at < nowUnix) {
        console.log(`Webhook: Token expired for athlete ${athleteId} (Activity ID: ${activityId}). Refreshing...`);
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
            await query(`UPDATE athletes SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE id = $4`, [newTokens.access_token, newTokens.refresh_token, newTokens.expires_at, athleteId]);
            athlete.access_token = newTokens.access_token; // Update in-memory token
            console.log(`Webhook: Token refreshed successfully for athlete ${athleteId}.`);
        } else {
            console.error(`Webhook: Failed to refresh token for athlete ${athleteId} (Activity ID: ${activityId}). Status: ${tokenRes.status}, Body: ${await tokenRes.text()}`);
            return; // Stop processing if token refresh fails
        }
    }

    // Fetch activity details from Strava API
    const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=true`, {
        headers: { Authorization: `Bearer ${athlete.access_token}` }
    });

    if (!response.ok) {
        console.error(`Webhook: Failed to fetch activity ${activityId} for athlete ${athleteId}. Status: ${response.status}`);
        return; // Stop processing if activity fetch fails
    }
    const activity = await response.json();
    
    // Ensure activity has segment efforts
    if (!activity.segment_efforts) {
        console.log(`Webhook: Activity ${activityId} for athlete ${athleteId} has no segment efforts.`);
        return;
    }
    
    // === OPTIMISATION WEBHOOK ===
    // Ignore virtual or manually entered activities
    const isVirtualOrManual = activity.manual || activity.type === 'VirtualRide' || activity.type === 'VirtualRun' || activity.sport_type === 'VirtualRide';
    if (isVirtualOrManual) {
        console.log(`☑️ Webhook: Activity ${activityId} ignored (Manual or Virtual) for athlete ${athleteId}.`);
        return; // Exit early if filtered
    }
    // ============================
	
    // Determine if the athlete is restricted to specific challenges
    const isRestricted = athlete.restricted_challenge_ids && athlete.restricted_challenge_ids.length > 0;
    
    let activeSegmentsQuery;
    let queryParams = [];

    if (isRestricted) {
        // If restricted, only listen to segments from their allowed challenges
        activeSegmentsQuery = `SELECT DISTINCT segment_id FROM challenge_segments WHERE challenge_id = ANY($1::int[])`;
        queryParams.push(athlete.restricted_challenge_ids);
        console.log(`Webhook: Athlete ${athleteId} (Activity: ${activityId}) is restricted. Checking segments for challenges: ${athlete.restricted_challenge_ids}`);
    } else {
        // If not restricted, listen to all segments from all challenges
        activeSegmentsQuery = `SELECT DISTINCT segment_id FROM challenge_segments`;
        console.log(`Webhook: Athlete ${athleteId} (Activity: ${activityId}) is not restricted. Checking all challenge segments.`);
    }

    const activeSegments = await query(activeSegmentsQuery, queryParams);
    const activeSegIds = new Set(activeSegments.map(s => s.segment_id.toString()));

    if (activeSegIds.size === 0) {
        console.log(`Webhook: No active segments found for athlete ${athleteId} (Activity: ${activityId}). No processing needed.`);
        return;
    }

    let processedEffortsCount = 0; // Count of relevant efforts processed from the activity
    let impactedSegments = []; // To track segments that were part of this activity and are relevant to challenges

    for (const effort of activity.segment_efforts) {
        if (activeSegIds.has(effort.segment.id.toString())) {
            // This segment is relevant to at least one challenge
            impactedSegments.push(effort.segment.id);
            
            try {
                // Attempt to insert the effort. ON CONFLICT DO NOTHING handles duplicates.
                // The `query` function should ideally return information about whether an insert occurred.
                // Assuming `query` returns an object with `rowCount` or similar.
                // If the `query` function doesn't return `rowCount`, this part might need adjustment based on its actual return value.
                await query(`
                    INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (effort_id) DO NOTHING
                `, [effort.id, effort.segment.id, athleteId, athleteName, effort.start_date_local, effort.elapsed_time]);
                
                processedEffortsCount++; // Increment for every relevant effort found in the activity that was processed (attempted insert)
                
            } catch (dbErr) {
                console.error(`Webhook: Error inserting segment effort ${effort.id} for athlete ${athleteId} (Activity: ${activityId}):`, dbErr);
                // Continue processing other efforts, but log the error.
            }
        }
    }

    // --- LOGIQUE DE DÉCLENCHEMENT DU RECALCUL AMÉLIORÉE ---
    // Recalculer si des efforts pertinents ont été trouvés dans l'activité,
    // qu'ils aient été nouvellement insérés ou déjà existants.
    if (impactedSegments.length > 0) {
        console.log(`Webhook: Processed ${processedEffortsCount} relevant efforts involving ${impactedSegments.length} unique segments for athlete ${athleteName} (Activity ID: ${activityId}).`);

        try {
            // Trouver tous les défis qui impliquent ces segments impactés
            const affectedChallenges = await query(`
                SELECT DISTINCT challenge_id 
                FROM challenge_segments 
                WHERE segment_id = ANY($1::bigint[])
            `, [impactedSegments]);

            if (affectedChallenges.length > 0) {
                console.log(`Webhook: Found ${affectedChallenges.length} challenges affected by this activity (Activity ID: ${activityId}).`);
                for (const row of affectedChallenges) {
                    console.log(`🔄 Webhook: Triggering recalculation for challenge ${row.challenge_id} in background...`);
                    // Déclencher le calcul du classement pour chaque défi affecté.
                    // La fonction de rappel (callback) est un no-op car le webhook doit juste initier le processus.
                    await calculateLeaderboard(row.challenge_id, () => {}); 
                }
            } else {
                console.log(`Webhook: No challenges found associated with the impacted segments for activity ${activityId}.`);
            }
        } catch (calcErr) {
            console.error("Webhook error during leaderboard recalculation trigger (Activity ID: ${activityId}):", calcErr);
            // Log l'erreur mais ne pas échouer la réponse du webhook à Strava.
        }
    } else {
        console.log(`☑️ Webhook: No relevant segments found in activity ${activityId} for athlete ${athleteId}.`);
    }
}