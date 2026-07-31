import { query } from "../../db.js";

// A secret string you invent to verify Strava is the one calling your API
const VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN || "segseq_secure_webhook_123";

export default async function handler(req, res) {
  // ==========================================================
  // 1. WEBHOOK SUBSCRIPTION VALIDATION (Strava Setup Check)
  // ==========================================================
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
  
  // ==========================================================
  // 2. RECEIVE INCOMING ACTIVITY EVENTS
  // ==========================================================
  else if (req.method === 'POST') {
    const event = req.body;
    console.log("Strava webhook event received:", event);

    // We must acknowledge receipt immediately (HTTP 200) so Strava doesn't retry
    res.status(200).send('EVENT_RECEIVED');

    // Only process NEW activities (ignore updates/deletes for now to save processing)
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

// ==========================================================
// 3. BACKGROUND PROCESSING LOGIC
// ==========================================================
async function processActivity(athleteId, activityId) {
  // 1. Check if this athlete is registered in our database
  const athletes = await query(`SELECT firstname, lastname, access_token, refresh_token, expires_at FROM athletes WHERE id = $1`, [athleteId]);
  if (athletes.length === 0) return; 
  
  let athlete = athletes[0];
  const athleteName = `${athlete.firstname} ${athlete.lastname}`.trim();

  // 2. Ensure token is valid (Refresh if expired)
  const nowUnix = Math.floor(Date.now() / 1000);
  if (athlete.expires_at < nowUnix) {
    console.log(`Token expired for ${athleteName}. Refreshing in background...`);
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
      await query(`
        UPDATE athletes SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE id = $4
      `, [newTokens.access_token, newTokens.refresh_token, newTokens.expires_at, athleteId]);
      
      athlete.access_token = newTokens.access_token; // Use new token for the next step
    } else {
      console.error(`Failed to refresh token for ${athleteName}`);
      return;
    }
  }

  // 3. Fetch the specific activity from Strava (Costs exactly 1 API call)
  const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=true`, {
    headers: { Authorization: `Bearer ${athlete.access_token}` }
  });

  if (!response.ok) return;
  const activity = await response.json();
  if (!activity.segment_efforts) return;

  // 4. Get all segments that are part of ANY active challenge in our app
  const activeSegments = await query(`SELECT DISTINCT segment_id FROM challenge_segments`);
  const activeSegIds = new Set(activeSegments.map(s => s.segment_id.toString()));

  // 5. Check if the athlete ran any of our challenge segments today
  let inserted = 0;
  for (const effort of activity.segment_efforts) {
    if (activeSegIds.has(effort.segment.id.toString())) {
      await query(`
        INSERT INTO segment_efforts (segment_id, athlete_name, start_date, elapsed_time)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (segment_id, athlete_name, start_date) DO NOTHING
      `, [effort.segment.id, athleteName, effort.start_date_local, effort.elapsed_time]);
      inserted++;
    }
  }

  if (inserted > 0) {
    console.log(`✅ Webhook Success: Saved ${inserted} challenge efforts for ${athleteName}`);
  }
}