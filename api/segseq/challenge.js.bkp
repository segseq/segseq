import { query } from "../../db.js";
import { parse } from "cookie-es";
import jwt from "jsonwebtoken";

export default async function handler(req, res) {
  const { method } = req;
  const id = req.query.id;

  // Récupération et vérification sécurisée du cookie
  const cookies = parse(req.headers.cookie || "");
  const sessionToken = cookies.session;
  let currentAthleteId = null;

  if (sessionToken) {
    try {
      const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
      currentAthleteId = decoded.athleteId; // L'ID est garanti authentique
    } catch (err) {
      console.error("Token de session invalide :", err.message);
      // On ne bloque pas ici car les requêtes GET (lecture) peuvent être publiques
    }
  }

  try {
    // ==========================================
    // HANDLE GET REQUESTS (Read)
    // ==========================================
    if (method === "GET") {
      
      // 1A. GET ALL CHALLENGES (For Explore Page)
      if (!id) {
        // MODIFICATION : Suppression de 'sport' de la requête
        const rows = await query(`
          SELECT id, creator_id, name, duration_hours, created_at
          FROM challenges
          ORDER BY created_at DESC
        `);
        
        // Check permissions on the server side
        const challengesWithPermissions = rows.map(row => ({
          ...row,
          can_delete: currentAthleteId && String(row.creator_id) === String(currentAthleteId)
        }));

        return res.status(200).json(challengesWithPermissions);
      }
      
      // 1B. GET SINGLE CHALLENGE (For Challenge Details Page)
      else {
        // MODIFICATION : Suppression de 'sport' et ajout de 'strict_sequence'
        const challengeRows = await query(
          `SELECT id, creator_id, name, description, duration_hours, strict_sequence
           FROM challenges
           WHERE id = $1`,
          [id]
        );

        if (challengeRows.length === 0) {
          return res.status(404).json({ error: "Challenge not found" });
        }

        const challenge = challengeRows[0];

        const segmentRows = await query(
          `SELECT segment_id, order_index
           FROM challenge_segments
           WHERE challenge_id = $1
           ORDER BY order_index ASC`,
          [id]
        );

        const creatorDb = await query(`SELECT access_token FROM athletes WHERE id = $1`, [challenge.creator_id]);
        const token = creatorDb.length > 0 ? creatorDb[0].access_token : null;

        let totalDistance = 0;
        let totalElevation = 0;
        
        const enrichedSegments = await Promise.all(segmentRows.map(async (s) => {
          // MODIFICATION : Initialisation des nouvelles variables
          let extraData = { name: null, distance: 0, elevation: 0, activity_type: null, average_grade: null };
          
          if (token) {
            try {
              const stravaRes = await fetch(`https://www.strava.com/api/v3/segments/${s.segment_id}`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (stravaRes.ok) {
                const data = await stravaRes.json();
                // MODIFICATION : Extraction du sport et de la pente depuis Strava
                extraData = {
                  name: data.name,
                  distance: data.distance || 0,
                  elevation: data.total_elevation_gain || 0,
                  activity_type: data.activity_type, // NOUVEAU
                  average_grade: data.average_grade  // NOUVEAU
                };
                totalDistance += extraData.distance;
                totalElevation += extraData.elevation;
              }
            } catch (e) { console.error("Strava fetch error:", e); }
          }

          // MODIFICATION : Renvoi des nouvelles données
          return {
            id: s.segment_id,
            order: s.order_index,
            name: extraData.name,
            distance: extraData.distance,
            elevation: extraData.elevation,
            activity_type: extraData.activity_type, // NOUVEAU
            average_grade: extraData.average_grade  // NOUVEAU
          };
        }));

        enrichedSegments.sort((a, b) => a.order - b.order);

        // MODIFICATION : Nettoyage du JSON final
        return res.status(200).json({
          id: challenge.id,
          creator_id: challenge.creator_id,
          name: challenge.name,
          description: challenge.description,
          duration: challenge.duration_hours,
          strict_sequence: challenge.strict_sequence, // NOUVEAU (Pour le frontend)
          total_distance: totalDistance,
          total_elevation: totalElevation,
          segments: enrichedSegments
        });
      }
    }

    // ==========================================
    // HANDLE DELETE REQUESTS (Delete)
    // ==========================================
    else if (method === "DELETE") {
      if (!id) {
        return res.status(400).json({ error: "Missing challenge id to delete" });
      }

      if (!currentAthleteId) {
        return res.status(401).json({ error: "You must be logged in to delete a challenge." });
      }

      const checkOwner = await query(`SELECT creator_id FROM challenges WHERE id = $1`, [id]);
      
      if (checkOwner.length === 0) {
        return res.status(404).json({ error: "Challenge not found" });
      }

      if (String(checkOwner[0].creator_id) !== String(currentAthleteId)) {
        return res.status(403).json({ error: "Forbidden: You can only delete challenges you created." });
      }

      await query(`DELETE FROM challenge_results WHERE challenge_id = $1`, [id]);
      await query(`DELETE FROM challenge_segments WHERE challenge_id = $1`, [id]);
      const result = await query(`DELETE FROM challenges WHERE id = $1 RETURNING id`, [id]);

      return res.status(200).json({ success: true, deleted_id: id });
    }

    else {
      return res.status(405).json({ error: "Method not allowed" });
    }

  } catch (err) {
    console.error("DB error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}