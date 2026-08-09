/* ------------------------------ */
/* ./api/strava/callback.js */
/* ------------------------------ */

// --- IMPORTS ---
import { query } from "../../db.js";
import jwt from "jsonwebtoken";

// Fonction utilitaire pour le délai
const delay = (ms) => new Promise(res => setTimeout(res, ms));


// --- HANDLER ---
export default async function handler(req, res) {
  const urlObj = new URL(req.url, `https://${req.headers.host}`);
  const code = urlObj.searchParams.get("code");

  if (!code) return res.status(400).send("Missing authorization code");

  try {
    // --- 1. Échanger le code ---
    const payload = {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code"
    };
    
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const textResponse = await response.text();
    let data;
    try { data = JSON.parse(textResponse); } 
    catch (e) { return res.status(500).send("Strava API failed (HTML returned)."); }

    if (!data.access_token || !data.athlete.id) return res.status(500).json({ error: "Auth failed", details: data });

    const athleteId = data.athlete.id;
    const athleteName = `${data.athlete.firstname || ''} ${data.athlete.lastname || ''}`.trim();

    // --- 2. UPSERT dans la base (Athlète) ---
    await query(
      `INSERT INTO athletes (id, firstname, lastname, profile, country, sex, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET 
         firstname = COALESCE(EXCLUDED.firstname, athletes.firstname),
         lastname = COALESCE(EXCLUDED.lastname, athletes.lastname),
         profile = COALESCE(EXCLUDED.profile, athletes.profile),
         country = COALESCE(EXCLUDED.country, athletes.country),
         sex = COALESCE(EXCLUDED.sex, athletes.sex),
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at`,
      [
        athleteId, data.athlete.firstname || null, data.athlete.lastname || null,
        data.athlete.profile || null, data.athlete.country || null, data.athlete.sex || null,
        data.access_token, data.refresh_token, data.expires_at
      ]
    );

    // --- 3. BACKFILL OPTIMISÉ (Performances du nouvel athlète) ---
    const segmentsDb = await query(`SELECT DISTINCT segment_id FROM challenge_segments`);
    
    await (async () => {
      for (const row of segmentsDb) {
        try {
          // Ajout de per_page=200 pour maximiser la récupération
        const stravaRes = await fetch(`https://www.strava.com/api/v3/segment_efforts?segment_id=${row.segment_id}&per_page=200`, {
            headers: { Authorization: `Bearer ${data.access_token}` }
          });
          
          if (stravaRes.ok) {
            const efforts = await stravaRes.json();
            for (const effort of efforts) {
              // Insertion ultra-rapide grâce à la contrainte UNIQUE sur effort_id
              await query(
                `INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (effort_id) DO NOTHING`,
                [effort.id, row.segment_id, athleteId, athleteName, effort.start_date, effort.elapsed_time]
              );
            }
          }
		  await delay(200); 

        } catch (e) { console.error(`Erreur backfill callback pour segment ${row.segment_id}:`, e); }
      }
    })();

    // --- 4. Cookies & Redirection ---
    const cookieFlags = "Path=/; HttpOnly; Secure; SameSite=None";
    const sessionToken = jwt.sign({ athleteId: athleteId }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.setHeader("Set-Cookie", [
      `session=${sessionToken}; ${cookieFlags}`,
      `strava_token=${data.access_token}; ${cookieFlags}`
    ]);

    return res.redirect("https://segseq.vercel.app/profile.html");

  } catch (err) {
    console.error("Callback crash:", err);
    return res.status(500).send("Internal Server Error during callback");
  }
}