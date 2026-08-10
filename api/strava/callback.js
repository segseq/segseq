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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET 
         firstname = COALESCE(EXCLUDED.firstname, athletes.firstname),
         lastname = COALESCE(EXCLUDED.lastname, athletes.lastname),
         profile = COALESCE(EXCLUDED.profile, athletes.profile),
         country = COALESCE(EXCLUDED.country, athletes.country),
         sex = COALESCE(EXCLUDED.sex, athletes.sex),
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at`,
		 scope = EXCLUDED.scope`,
      [
        athleteId, data.athlete.firstname || null, data.athlete.lastname || null,
        data.athlete.profile || null, data.athlete.country || null, data.athlete.sex || null,
        data.access_token, data.refresh_token, data.expires_at, data.scope 
      ]
    );

    // --- 3. DÉCLENCHEMENT DU BACKFILL EN ARRIÈRE-PLAN ---
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host;
        const backfillUrl = `${protocol}://${host}/api/admin-backfill?athlete_id=${athleteId}`;
        
        setTimeout(() => {
			fetch(backfillUrl).catch(err => console.error("Erreur lancement backfill:", err));
			}, 2000);

        // --- 4. Cookies & Redirection ---
        const cookieFlags = "Path=/; HttpOnly; Secure; SameSite=None";
        const sessionToken = jwt.sign(
            { athleteId: athleteId }, 
            process.env.JWT_SECRET, 
            { expiresIn: '7d' }
        );

        /* res.setHeader("Set-Cookie", [
            `session=${sessionToken}; ${cookieFlags}`,
			`strava_token=${data.access_token}; ${cookieFlags}`
        ]); */
		res.setHeader("Set-Cookie", [
            `session=${sessionToken}; ${cookieFlags}`
		]);

        return res.redirect("https://segseq.vercel.app/profile.html");

    } catch (err) {
        console.error("Callback crash:", err);
        return res.status(500).send("Internal Server Error during callback");
    }
}