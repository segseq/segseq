import { query } from "../db.js";
import { parse } from "cookie-es";
import jwt from "jsonwebtoken";
import { getValidStravaToken } from './strava/token.js';

export default async function handler(req, res) {
  const { action, id: segmentId } = req.query;

  // --- LOGOUT DOIT ÊTRE GÉRÉ EN PREMIER ---
  if (action === "logout") {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    try {
      const pastCookieFlags = "Path=/; HttpOnly; Secure; SameSite=None; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
      res.setHeader("Set-Cookie", [
        `session=; ${pastCookieFlags}`,
        `strava_token=; ${pastCookieFlags}`
      ]);
      return res.status(200).json({ success: true, message: "Déconnexion réussie." });
    } catch (err) {
      return res.status(500).json({ error: "Erreur serveur lors de la déconnexion." });
    }
  }

  // --- AUTHENTIFICATION ---
  const cookies = parse(req.headers.cookie || "");
  const sessionToken = cookies.session;

  if (!sessionToken) {
    if (action === 'getProfile' || action === 'getStarredSegments') {
      return res.status(401).json({ error: "Non authentifié" });
    }
  }

  let athleteId = null;
  if (sessionToken) {
    try {
      const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
      athleteId = decoded.athleteId;
    } catch (err) {
      return res.status(401).json({ error: "Session invalide" });
    }
  }

  try {
    // --- ROUTEUR INTERNE ---
    if (action === 'getProfile') {
      if (!athleteId) return res.status(401).json({ error: "Non authentifié" });

      const validAccessToken = await getValidStravaToken(athleteId);
      if (!validAccessToken) {
        return res.status(401).json({ error: "Session Strava invalide, veuillez vous reconnecter." });
      }

      const athleteRes = await fetch("https://www.strava.com/api/v3/athlete", {
        headers: { Authorization: `Bearer ${validAccessToken}` }
      });

      if (!athleteRes.ok) throw new Error('Échec de la récupération du profil Strava');

      const athlete = await athleteRes.json();
	  
	  try {
          const localDbRes = await query(`SELECT is_admin, restricted_challenge_ids FROM athletes WHERE id = $1`, [athleteId]);
          if (localDbRes.length > 0) {
              athlete.is_admin = localDbRes[0].is_admin;
              athlete.restricted_challenge_ids = localDbRes[0].restricted_challenge_ids || [];
          } else {
              athlete.is_admin = false;
              athlete.restricted_challenge_ids = [];
          }
      } catch (dbErr) {
          console.error("Erreur SQL (ignorée) :", dbErr);
          athlete.is_admin = false;
          athlete.restricted_challenge_ids = [];
      }


      return res.status(200).json(athlete);
    }
    else if (action === 'getStarredSegments') {
      if (!athleteId) return res.status(401).json({ error: "Non authentifié" });

      const validAccessToken = await getValidStravaToken(athleteId);
      if (!validAccessToken) return res.status(401).json({ error: "Impossible d'obtenir un token Strava valide." });

      const stravaRes = await fetch("https://www.strava.com/api/v3/segments/starred?page=1&per_page=200", {
        headers: { Authorization: `Bearer ${validAccessToken}` }
      });

      if (!stravaRes.ok) throw new Error("Erreur lors de la communication avec Strava");

      const segments = await stravaRes.json();
      const simplifiedSegments = segments.map(seg => ({
        id: seg.id, name: seg.name, distance: seg.distance, city: seg.city || ""
      }));

      return res.status(200).json(simplifiedSegments);
    }
    else if (action === 'validateSegment') {
      if (!athleteId) return res.status(401).json({ error: "Non authentifié pour valider un segment." });
      if (!segmentId) return res.status(400).json({ error: "Missing segment ID" });

      const validAccessToken = await getValidStravaToken(athleteId);
      if (!validAccessToken) return res.status(401).json({ error: "Impossible d'obtenir un token Strava valide." });

      const stravaRes = await fetch(`https://www.strava.com/api/v3/segments/${segmentId}`, {
        headers: { Authorization: `Bearer ${validAccessToken}` }
      });

      if (!stravaRes.ok) return res.status(404).json({ error: "Segment introuvable ou privé." });

      const data = await stravaRes.json();
      return res.status(200).json({ name: data.name, distance: data.distance, activity_type: data.activity_type });
    }
    else {
      return res.status(400).json({ error: "Action non spécifiée ou invalide." });
    }
  } catch (err) {
    console.error(`Erreur API pour l'action '${action}':`, err.message);
    return res.status(500).json({ error: "Erreur serveur", details: err.message });
  }
}
