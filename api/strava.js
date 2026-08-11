// Fichier : /api/strava.js

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
      const pastCookieFlags =
        "Path=/; HttpOnly; Secure; SameSite=None; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

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

      if (!athleteRes.ok) {
        console.error("Erreur Strava API:", athleteRes.status);
        throw new Error('Échec de la récupération du profil Strava');
      }

      const athlete = await athleteRes.json();

      // --- AJOUT SÉCURISÉ POUR L'ADMIN ---
      try {
          const localDbRes = await query(`SELECT is_admin FROM athletes WHERE id = $1`, [athleteId]);
          
          if (localDbRes && localDbRes.length > 0) {
              athlete.is_admin = localDbRes[0].is_admin === true;
          } else {
              athlete.is_admin = false;
          }
      } catch (dbErr) {
          console.error("Erreur SQL (ignorée) :", dbErr);
          athlete.is_admin = false;
      }
      // --- FIN DE L'AJOUT ---

      return res.status(200).json(athlete);
    }
