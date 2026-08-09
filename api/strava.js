// Fichier : /api/strava.js (VERSION FINALE ET SÉCURISÉE)

import { query } from "../db.js";
import { parse } from "cookie-es";
import jwt from "jsonwebtoken";
import { getValidStravaToken } from './strava/token.js'; // Assurez-vous que ce chemin est correct

export default async function handler(req, res) {
  const { action, id: segmentId } = req.query; // Renommé 'id' en 'segmentId' pour plus de clarté

  // 1. Authentification centralisée via le cookie de session JWT
  const cookies = parse(req.headers.cookie || "");
  const sessionToken = cookies.session;

  if (!sessionToken) {
    // Si aucune action ne requiert d'être authentifié, on peut continuer (ex: future action publique)
    // Mais pour celles qui le requièrent, on bloque ici.
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

    // ACTION 1 : Récupérer le profil de l'utilisateur connecté
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
      return res.status(200).json(athlete);
    }

    // ACTION 2 : Récupérer les segments favoris de l'utilisateur (logique sécurisée)
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

    // ACTION 3 : Valider un ID de segment (logique sécurisée)
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
      return res.status(200).json({ name: data.name, distance: data.distance });
    }

    // Si aucune action ne correspond
    else {
      return res.status(400).json({ error: "Action non spécifiée ou invalide." });
    }

  } catch (err) {
    console.error(`Erreur API pour l'action '${action}':`, err.message);
    return res.status(500).json({ error: "Erreur serveur", details: err.message });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.query.action === 'logout') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Crée une date d'expiration dans le passé pour dire au navigateur de supprimer les cookies.
    const pastCookieFlags = "Path=/; HttpOnly; Secure; SameSite=None; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

    // On envoie l'instruction de supprimer le cookie de session et, par sécurité, l'ancien strava_token
    res.setHeader("Set-Cookie", [
      `session=; ${pastCookieFlags}`,
      `strava_token=; ${pastCookieFlags}`
    ]);

    // On confirme que l'opération a réussi
    res.status(200).json({ success: true, message: "Déconnexion réussie." });

  } catch (err) {
    res.status(500).json({ error: "Erreur serveur lors de la déconnexion." });
  }
}
