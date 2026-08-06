// --- IMPORTS ---
import { query } from "../../db.js";
import jwt from "jsonwebtoken"; // NOUVEL IMPORT

// --- HANDLER ---
export default async function handler(req, res) {
  const urlObj = new URL(req.url, `https://${req.headers.host}`);
  const code = urlObj.searchParams.get("code");

  if (!code) return res.status(400).send("Missing authorization code");

  try {
    // --- 1. Échanger le code contre un token Strava ---
    // ... (Votre code actuel reste inchangé ici) ...
    const response = await fetch("https://www.strava.com/oauth/token", { /*...*/ });
    const data = await response.json();
    const athlete = data.athlete || {};
    const athleteId = athlete.id;

    if (!athleteId) return res.status(500).send("Strava API error: Missing athlete ID");

    // --- 2. UPSERT dans la base ---
    // ... (Votre code actuel reste inchangé ici) ...
    await query(`INSERT INTO athletes ...`, [ /*...*/ ]);

    // --- 3. Cookies Sécurisés ---
    const cookieFlags = "Path=/; HttpOnly; Secure; SameSite=None";

    // NOUVEAU : Création d'un token signé cryptographiquement
    // Assurez-vous d'ajouter JWT_SECRET dans vos variables d'environnement Vercel
    const sessionToken = jwt.sign(
      { athleteId: athleteId }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' } // Expire dans 7 jours
    );

    res.setHeader("Set-Cookie", [
      // On remplace "athlete_id" par un jeton de session sécurisé
      `session=${sessionToken}; ${cookieFlags}`,
      `strava_token=${data.access_token}; ${cookieFlags}`
    ]);

    // --- 4. Redirection ---
    return res.redirect("https://segseq.vercel.app/profile.html");

  } catch (err) {
    console.error("Callback crash:", err);
    return res.status(500).send("Token exchange failed");
  }
}