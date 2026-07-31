// --- IMPORTS ---
import { query } from "../../db.js";

// --- HANDLER ---
export default async function handler(req, res) {
  // Récupération du code via WHATWG URL API
  const urlObj = new URL(req.url, `https://${req.headers.host}`);
  const code = urlObj.searchParams.get("code");

  console.log("STRAVA CALLBACK — code reçu :", code);

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  try {
    // --- 1. Échanger le code contre un token Strava ---
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code"
      })
    });

    const data = await response.json();
    console.log("STRAVA TOKEN RESPONSE:", data);

    if (!data.access_token) {
      console.error("Strava token error:", data);
      return res.status(500).json({
        error: "Token exchange failed",
        details: data
      });
    }

    const athlete = data.athlete || {};
    const athleteId = athlete.id;

    if (!athleteId) {
      console.error("No athlete ID returned from Strava");
      return res.status(500).send("Strava API error: Missing athlete ID");
    }

    // --- 2. UPSERT dans la base avec COALESCE ---
    // COALESCE(nouvelle_valeur, ancienne_valeur) protège contre l'écrasement par NULL
    await query(
      `INSERT INTO athletes (id, firstname, lastname, profile, country, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET 
         firstname = COALESCE(EXCLUDED.firstname, athletes.firstname),
         lastname = COALESCE(EXCLUDED.lastname, athletes.lastname),
         profile = COALESCE(EXCLUDED.profile, athletes.profile),
         country = COALESCE(EXCLUDED.country, athletes.country),
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at`,
      [
        athleteId,
        athlete.firstname || null,
        athlete.lastname || null,
        athlete.profile || null,
        athlete.country || null,
        data.access_token,
        data.refresh_token,
        data.expires_at
      ]
    );

    console.log("ATHLETE AND TOKENS UPSERTED:", athleteId);

    // --- 3. Cookies ---
    const cookieFlags = "Path=/; HttpOnly; Secure; SameSite=None";

    res.setHeader("Set-Cookie", [
      `athlete_id=${athleteId}; ${cookieFlags}`,
      `strava_token=${data.access_token}; ${cookieFlags}`
    ]);

    console.log("COOKIES SET FOR ATHLETE:", athleteId);

    // --- 4. Redirection ---
    return res.redirect("https://segseq.vercel.app/profile.html");

  } catch (err) {
    console.error("Callback crash:", err);
    return res.status(500).send("Token exchange failed");
  }
}