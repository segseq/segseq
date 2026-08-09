/* ------------------------------ */
/* ./api/strava/webhook.js */
/* ------------------------------ */

import { query } from "../../db.js";
// ATTENTION: Ajuste le chemin relatif ci-dessous selon la structure de tes dossiers
import { calculateLeaderboard } from "../segseq/leaderboards.js"; 

const VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN || "segseq_secure_webhook_123";

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WEBHOOK VERIFIED BY STRAVA');
        return res.status(200).json({ "hub.challenge": challenge });
      } else {
        return res.status(403).send('Forbidden');
      }
    }
    return res.status(400).send('Bad Request');
  } 
  else if (req.method === 'POST') {
    const event = req.body;
    res.status(200).send('EVENT_RECEIVED'); // Ack immédiat

    if (event.object_type === 'activity' && event.aspect_type === 'create') {
      try {
        await processActivity(event.owner_id, event.object_id);
      } catch (err) {
        console.error("Error processing webhook activity:", err);
      }
    }
  } else {
    res.status(405).send('Method Not Allowed');
  }
}

async function processActivity(athleteId, activityId) {
  const athletes = await query(`SELECT firstname, lastname, access_token, refresh_token, expires_at FROM athletes WHERE id = $1`, [athleteId]);
  if (athletes.length === 0) return; 
  
  let athlete = athletes[0];
  const athleteName = `${athlete.firstname} ${athlete.lastname}`.trim();

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
      await query(`UPDATE athletes SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE id = $4`, [newTokens.access_token, newTokens.refresh_token, newTokens.expires_at, athleteId]);
      athlete.access_token = newTokens.access_token;
    } else return;
  }

  const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=true`, {
    headers: { Authorization: `Bearer ${athlete.access_token}` }
  });

  if (!response.ok) return;
  const activity = await response.json();
  if (!activity.segment_efforts) return;

  const activeSegments = await query(`SELECT DISTINCT segment_id FROM challenge_segments`);
  const activeSegIds = new Set(activeSegments.map(s => s.segment_id.toString()));

  let inserted = 0;
  let impactedSegments = []; // Pour tracker les segments touchés

  for (const effort of activity.segment_efforts) {
    if (activeSegIds.has(effort.segment.id.toString())) {
      await query(`
        INSERT INTO segment_efforts (segment_id, athlete_name, start_date, elapsed_time)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (segment_id, athlete_name, start_date) DO NOTHING
      `, [effort.segment.id, athleteName, effort.start_date_local, effort.elapsed_time]);
      inserted++;
      impactedSegments.push(effort.segment.id);
    }
  }

  if (inserted > 0) {
    console.log(`✅ Webhook: Saved ${inserted} efforts for ${athleteName}`);
    
    // === NOUVEAU: DÉCLENCHEMENT DU CALCUL ===
    try {
      // Trouver tous les challenges impactés par ces nouveaux segments
      const affectedChallenges = await query(`
        SELECT DISTINCT challenge_id 
        FROM challenge_segments 
        WHERE segment_id = ANY($1::bigint[])
      `, [impactedSegments]);

      // Lancer le recalcul pour chaque challenge en arrière-plan
      for (const row of affectedChallenges) {
        console.log(`🔄 Webhook: Recalcul du challenge ${row.challenge_id} en arrière-plan...`);
        // On passe une fonction vide pour les logs pour ne pas polluer la console
        await calculateLeaderboard(row.challenge_id, () => {}); 
      }
    } catch (err) {
      console.error("Erreur lors du recalcul via Webhook:", err);
    }
  }
}