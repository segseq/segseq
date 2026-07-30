// --- CONFIG : activer bodyParser pour req.query ---
export const config = {
  api: {
    bodyParser: true,
  },
};

// --- IMPORTS ---
import { query } from "../../db.js";

// --- HANDLER ---
export default async function handler(req, res) {
  const { code } = req.query;

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

    const athlete = data.athlete;
    const athleteId = athlete.id;

    // --- 2. Insérer l’athlète dans la base ---
    // On stocke au minimum l’ID, prénom, nom, photo
    await query(
      `INSERT INTO athletes (id, firstname, lastname, profile, country)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [
        athleteId,
        athlete.firstname || null,
        athlete.lastname || null,
        athlete.profile || null
		athlete.country || null
      ]
    );

    console.log("ATHLETE INSERTED OR ALREADY EXISTS:", athleteId);

    // --- 3. Définir les cookies correctement ---
    // IMPORTANT : SameSite=None + Secure pour que Chrome les envoie dans fetch()
    const cookieFlags = "Path=/; HttpOnly; Secure; SameSite=None";

    res.setHeader("Set-Cookie", [
      `athlete_id=${athleteId}; ${cookieFlags}`,
      `strava_token=${data.access_token}; ${cookieFlags}`
    ]);

    console.log("COOKIES SET FOR ATHLETE:", athleteId);

    // --- 4. Redirection vers ton frontend ---
    return res.redirect("https://segseq.vercel.app/profile.html");

  } catch (err) {
    console.error("Callback crash:", err);
    return res.status(500).send("Token exchange failed");
  }
}
