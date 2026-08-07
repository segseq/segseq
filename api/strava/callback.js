// --- IMPORTS ---
import { query } from "../../db.js";
import jwt from "jsonwebtoken";

// --- HANDLER ---
export default async function handler(req, res) {
  const urlObj = new URL(req.url, `https://${req.headers.host}`);
  const code = urlObj.searchParams.get("code");

  if (!code) return res.status(400).send("Missing authorization code");

  try {
    // --- 1. Échanger le code contre un token Strava ---
    const payload = {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code"
    };
    
    // DEBUG: Let's make sure Vercel is actually reading your variables
    console.log("Checking Env Vars: Client ID exists?", !!process.env.STRAVA_CLIENT_ID);

    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    // NOUVEAU : Lire en texte d'abord pour éviter le crash JSON
    const textResponse = await response.text();
    
    let data;
    try {
      data = JSON.parse(textResponse);
    } catch (parseError) {
      // Si Strava renvoie du HTML, on log l'erreur exacte et on arrête
      console.error("❌ STRAVA RETURNED HTML INSTEAD OF JSON. Raw response:");
      console.error(textResponse.substring(0, 500)); // Logs the first 500 characters of the HTML
      return res.status(500).send("Strava API failed. Check Vercel logs for the HTML response.");
    }

    if (!data.access_token) {
      console.error("Strava token error:", data);
      return res.status(500).json({ error: "Token exchange failed", details: data });
    }

    const athlete = data.athlete || {};
    const athleteId = athlete.id;

    if (!athleteId) return res.status(500).send("Strava API error: Missing athlete ID");

    // --- 2. UPSERT dans la base ---
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
        athleteId, athlete.firstname || null, athlete.lastname || null,
        athlete.profile || null, athlete.country || null,
        data.access_token, data.refresh_token, data.expires_at
      ]
    );

    // --- 3. Cookies ---
    const cookieFlags = "Path=/; HttpOnly; Secure; SameSite=None";
    const sessionToken = jwt.sign({ athleteId: athleteId }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.setHeader("Set-Cookie", [
      `session=${sessionToken}; ${cookieFlags}`,
      `strava_token=${data.access_token}; ${cookieFlags}`
    ]);

    // --- 4. Redirection ---
    return res.redirect("https://segseq.vercel.app/profile.html");

  } catch (err) {
    console.error("Callback crash:", err);
    return res.status(500).send("Internal Server Error during callback");
  }
}