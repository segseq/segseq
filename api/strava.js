// Fichier : /api/strava.js

// Imports communs (regroupez les imports des 3 fichiers)
import { query } from "../db.js"; // Attention, le chemin relatif change !
import { parse } from "cookie-es";

export default async function handler(req, res) {
    // Le paramètre 'action' déterminera quelle logique exécuter.
    const { action, id } = req.query;

    // --- ROUTEUR INTERNE ---

    // ACTION 1 : Récupérer le profil de l'utilisateur connecté
    if (action === 'getProfile') {
        try {
            // Logique de l'ancien /api/strava/me.js
            const cookieHeader = req.headers.cookie || "";
            const token = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('strava_token='))?.split('=')[1];

            if (!token) {
                return res.status(401).json({ error: "Not authenticated" });
            }
            
            const athleteRes = await fetch("https://www.strava.com/api/v3/athlete", {
                headers: { Authorization: `Bearer ${token}` }
            });
            const athlete = await athleteRes.json();
            return res.status(200).json(athlete);

        } catch (err) {
            console.error("Athlete fetch error:", err);
            return res.status(500).json({ error: "Failed to fetch athlete" });
        }
    }
    
    // ACTION 2 : Récupérer les segments favoris de l'utilisateur
    else if (action === 'getStarredSegments') {
        try {
            // Logique de l'ancien /api/strava/starred_segments.js
            const cookies = req.headers.cookie || '';
            const tokenMatch = cookies.match(/strava_token=([^;]+)/);
            if (!tokenMatch) {
                return res.status(401).json({ error: "Non authentifié" });
            }
            const accessToken = tokenMatch[1];

            const stravaRes = await fetch("https://www.strava.com/api/v3/segments/starred?page=1&per_page=200", {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!stravaRes.ok) {
                throw new Error("Erreur lors de la communication avec Strava");
            }
            const segments = await stravaRes.json();
            const simplifiedSegments = segments.map(seg => ({
                id: seg.id,
                name: seg.name,
                distance: seg.distance,
                city: seg.city || ''
            }));
            return res.status(200).json(simplifiedSegments);

        } catch (err) {
            console.error("Erreur starred segments:", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }
    }

    // ACTION 3 : Valider un ID de segment
    else if (action === 'validateSegment') {
        if (!id) return res.status(400).json({ error: "Missing segment ID" });
        try {
            // Logique de l'ancien /api/segseq/validate-segment.js
            // On prend un athlète au hasard avec un token valide
            const athletes = await query(`SELECT access_token, refresh_token, expires_at FROM athletes WHERE access_token IS NOT NULL LIMIT 1`);
            if (athletes.length === 0) return res.status(500).json({ error: "Aucun compte Strava lié." });
            
            let athlete = athletes[0];
            // ... (Ajoutez ici la logique de rafraîchissement du token si nécessaire, comme dans le fichier original)

            const stravaRes = await fetch(`https://www.strava.com/api/v3/segments/${id}`, {
                headers: { Authorization: `Bearer ${athlete.access_token}` }
            });
            if (!stravaRes.ok) return res.status(404).json({ error: "Segment introuvable ou privé." });
            
            const data = await stravaRes.json();
            return res.status(200).json({ name: data.name, distance: data.distance });

        } catch (err) {
            console.error("Erreur validation segment:", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }
    }

    // Si aucune action ne correspond
    else {
        return res.status(400).json({ error: "Action non spécifiée ou invalide." });
    }
}