import { query } from "../../db.js";
import { parse } from "cookie-es";
import jwt from "jsonwebtoken";

export default async function handler(req, res) {
  if (req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // --- 1. VÉRIFICATION DE SÉCURITÉ ---
  const cookies = parse(req.headers.cookie || "");
  const sessionToken = cookies.session;

  if (!sessionToken) return res.status(401).json({ error: "Non authentifié" });

  let athleteId;
  try {
    const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
    athleteId = decoded.athleteId;
  } catch (err) {
    return res.status(401).json({ error: "Session invalide" });
  }

  try {
    // --- 2. RÉCUPÉRATION DES INFOS (Pour Strava et nettoyage ciblé) ---
    const athleteData = await query(`SELECT firstname, lastname, access_token FROM athletes WHERE id = $1`, [athleteId]);
    
    if (athleteData.length === 0) {
      return res.status(404).json({ error: "Athlète introuvable" });
    }
    
    const { firstname, lastname, access_token } = athleteData[0];
    const athleteName = `${firstname} ${lastname}`.trim();

    // --- 3. NETTOYAGE DE LA BASE DE DONNÉES ---
    // A. Supprimer ses participations/efforts
    await query(`DELETE FROM segment_efforts WHERE athlete_name = $1`, [athleteName]);
    await query(`DELETE FROM challenge_results WHERE athlete_name = $1`, [athleteName]);
    
    // B. Supprimer les challenges qu'il a créés (et leurs dépendances)
    const userChallenges = await query(`SELECT id FROM challenges WHERE creator_id = $1`, [athleteId]);
    if (userChallenges.length > 0) {
      const challengeIds = userChallenges.map(c => c.id);
      // On supprime d'abord les enfants pour éviter les erreurs de clés étrangères
      await query(`DELETE FROM challenge_results WHERE challenge_id = ANY($1::bigint[])`, [challengeIds]);
      await query(`DELETE FROM challenge_segments WHERE challenge_id = ANY($1::bigint[])`, [challengeIds]);
      await query(`DELETE FROM challenges WHERE creator_id = $1`, [athleteId]);
    }

    // C. Supprimer le profil athlète
    await query(`DELETE FROM athletes WHERE id = $1`, [athleteId]);

    // --- 4. RÉVOCATION DE L'ACCÈS STRAVA ---
    if (access_token) {
      await fetch("https://www.strava.com/oauth/deauthorize", {
        method: "POST",
        headers: { "Authorization": `Bearer ${access_token}` }
      }).catch(err => console.error("Erreur révocation Strava:", err)); // On ne bloque pas si Strava échoue
    }

    // --- 5. DESTRUCTION DES COOKIES ---
    // On définit une date d'expiration dans le passé pour forcer le navigateur à les supprimer
    const pastCookieFlags = "Path=/; HttpOnly; Secure; SameSite=None; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
    res.setHeader("Set-Cookie", [
      `session=; ${pastCookieFlags}`,
      `strava_token=; ${pastCookieFlags}`
    ]);

    return res.status(200).json({ success: true, message: "Compte et données supprimés avec succès." });

  } catch (err) {
    console.error("Erreur lors de la suppression du compte:", err);
    return res.status(500).json({ error: "Erreur serveur lors de la suppression." });
  }
}