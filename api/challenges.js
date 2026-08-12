/* ------------------------------ */
/* ./api/challenges.js */
/* ------------------------------ */

// --- CONFIG ---
export const config = { api: { bodyParser: true } };

// --- IMPORTS ---
import { query } from "../db.js";
import { parse } from "cookie-es";
import jwt from "jsonwebtoken";

// --- HELPER ---
const delay = (ms) => new Promise(res => setTimeout(res, ms));

export default async function handler(req, res) {
  const { method } = req;
  const id = req.query.id;

  // --- AUTHENTIFICATION ---
  const cookies = parse(req.headers.cookie || "");
  const sessionToken = cookies.session;
  let currentAthleteId = null;

  if (sessionToken) {
    try {
      const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
      currentAthleteId = decoded.athleteId;
    } catch (err) {
      if (method !== "GET") return res.status(401).json({ error: "Invalid session" });
    }
  }

  try {
    // ==========================================
    // POST : CRÉER UN DÉFI & BACKFILL INCRÉMENTAL
    // ==========================================
    if (method === "POST") {
      if (!currentAthleteId) return res.status(401).json({ error: "Not authenticated" });
      
      // On ajoute image_url ici
      const { name, description, duration, strict_sequence, segments, image_url } = req.body;
      if (!name || !duration || !Array.isArray(segments) || segments.length < 2) {
        return res.status(400).json({ error: "Invalid payload" });
      }

      // On l'ajoute dans la requête SQL
      const rows = await query(
        `INSERT INTO challenges (creator_id, name, description, duration_hours, strict_sequence, image_url)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [currentAthleteId, name, description, duration, strict_sequence, image_url]
      );
      const challengeId = rows[0].id;

      // Récupérer le token de l'utilisateur pour fetch les métadonnées
      const userDb = await query(`SELECT access_token FROM athletes WHERE id = $1`, [currentAthleteId]);
      const token = userDb.length > 0 ? userDb[0].access_token : null;

      for (let i = 0; i < segments.length; i++) {
        let sName = null, sDist = 0, sElev = 0, sGrade = 0, sSport = null;
        
        // Fetch Strava UNE SEULE FOIS à la création
        if (token) {
          try {
            const res = await fetch(`https://www.strava.com/api/v3/segments/${segments[i]}`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) {
              const data = await res.json();
              sName = data.name;
              sDist = data.distance || 0;
              sElev = data.total_elevation_gain || 0;
              sGrade = data.average_grade || 0;
              sSport = data.activity_type;
            }
          } catch(e) { console.error("Erreur fetch segment Strava:", e); }
        }

        await query(
          `INSERT INTO challenge_segments (challenge_id, segment_id, order_index, name, distance, elevation, grade, sport_type) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [challengeId, segments[i], i + 1, sName, sDist, sElev, sGrade, sSport]
        );
      }


      // BACKFILL OPTIMISÉ (Tous les athlètes pour les nouveaux segments)
      const athletes = await query(`SELECT id, firstname, lastname, access_token FROM athletes WHERE access_token IS NOT NULL`);
      
      (async () => {
        for (const athlete of athletes) {
          const athleteName = `${athlete.firstname || ''} ${athlete.lastname || ''}`.trim();
          
          for (const segmentId of segments) {
            try {
              const stravaRes = await fetch(`https://www.strava.com/api/v3/segment_efforts?segment_id=${segmentId}`, {
                headers: { Authorization: `Bearer ${athlete.access_token}` }
              });
              
              if (stravaRes.ok) {
                const efforts = await stravaRes.json();
                for (const effort of efforts) {
                  await query(
                    `INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (effort_id) DO NOTHING`,
                    [effort.id, segmentId, athlete.id, athleteName, effort.start_date, effort.elapsed_time]
                  );
                }
              }
              await delay(200); // Protection Rate Limit Strava
            } catch (e) { console.error(`Erreur backfill pour athlete ${athlete.id}:`, e); }
          }
        }
      })();

      return res.status(200).json({ id: challengeId });
    }

	// ==========================================
    // PUT : MODIFIER UN DÉFI
    // ==========================================
    else if (method === "PUT") {
      if (!currentAthleteId) return res.status(401).json({ error: "Not authenticated" });
      
       // On ajoute image_url ici
      const { id, name, description, duration, strict_sequence, segments, image_url } = req.body;
      if (!id || !name || !duration || !Array.isArray(segments) || segments.length < 2) {
        return res.status(400).json({ error: "Invalid payload" });
      }

      // Vérifier que l'utilisateur est le créateur
      const checkOwner = await query(`SELECT creator_id FROM challenges WHERE id = $1`, [id]);
      if (!checkOwner.length || String(checkOwner[0].creator_id) !== String(currentAthleteId)) {
        return res.status(403).json({ error: "Forbidden: You can only edit your own challenges." });
      }

      // 1. Mettre à jour le défi (avec image_url)
      await query(
        `UPDATE challenges SET name = $1, description = $2, duration_hours = $3, strict_sequence = $4, image_url = $5 WHERE id = $6`,
        [name, description, duration, strict_sequence, image_url, id]
      );


         // 2. Remplacer les segments (Fetch Strava pour les métadonnées)
      await query(`DELETE FROM challenge_segments WHERE challenge_id = $1`, [id]);
      
      const userDb = await query(`SELECT access_token FROM athletes WHERE id = $1`, [currentAthleteId]);
      const token = userDb.length > 0 ? userDb[0].access_token : null;

      for (let i = 0; i < segments.length; i++) {
        let sName = null, sDist = 0, sElev = 0, sGrade = 0, sSport = null;
        
        if (token) {
          try {
            const res = await fetch(`https://www.strava.com/api/v3/segments/${segments[i]}`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) {
              const data = await res.json();
              sName = data.name;
              sDist = data.distance || 0;
              sElev = data.total_elevation_gain || 0;
              sGrade = data.average_grade || 0;
              sSport = data.activity_type;
            }
          } catch(e) { console.error("Erreur fetch segment Strava:", e); }
        }

        await query(
          `INSERT INTO challenge_segments (challenge_id, segment_id, order_index, name, distance, elevation, grade, sport_type) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, segments[i], i + 1, sName, sDist, sElev, sGrade, sSport]
        );
      }


      // 3. Vider l'ancien classement (car les segments ou la durée ont pu changer)
      await query(`DELETE FROM challenge_results WHERE challenge_id = $1`, [id]);

      // 4. BACKFILL INCRÉMENTAL (Pour les nouveaux segments potentiellement ajoutés)
      const athletes = await query(`SELECT id, firstname, lastname, access_token FROM athletes WHERE access_token IS NOT NULL`);
      (async () => {
        for (const athlete of athletes) {
          const athleteName = `${athlete.firstname || ''} ${athlete.lastname || ''}`.trim();
          for (const segmentId of segments) {
            try {
              const stravaRes = await fetch(`https://www.strava.com/api/v3/segment_efforts?segment_id=${segmentId}`, {
                headers: { Authorization: `Bearer ${athlete.access_token}` }
              });
              if (stravaRes.ok) {
                const efforts = await stravaRes.json();
                for (const effort of efforts) {
                  await query(
                    `INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time)
                     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (effort_id) DO NOTHING`,
                    [effort.id, segmentId, athlete.id, athleteName, effort.start_date, effort.elapsed_time]
                  );
                }
              }
              await delay(200);
            } catch (e) { console.error(`Erreur backfill edit pour athlete ${athlete.id}:`, e); }
          }
        }
      })();

      return res.status(200).json({ success: true, id: id });
    }


// ==========================================
    // GET : LIRE LES DÉFIS
    // ==========================================
    else if (method === "GET") {
      if (!id) {
        // Liste des défis (pour explore.html) avec agrégation des sports
        const rows = await query(`
          SELECT c.id, c.creator_id, c.name, c.duration_hours, c.created_at, c.image_url, 
                 ARRAY_AGG(DISTINCT cs.sport_type) as sports
          FROM challenges c
          LEFT JOIN challenge_segments cs ON c.id = cs.challenge_id
          GROUP BY c.id
          ORDER BY c.created_at DESC
        `);
        return res.status(200).json(rows.map(row => ({ 
          ...row, 
          sports: row.sports.filter(s => s !== null), // Nettoyer les nulls
          can_delete: String(row.creator_id) === String(currentAthleteId) 
        })));
      } else {
        // Détail d'un défi (pour challenge.html) - SANS appel à l'API Strava !
        const challengeRows = await query(`SELECT * FROM challenges WHERE id = $1`, [id]);
        if (!challengeRows.length) return res.status(404).json({ error: "Not found" });
        
        // Vérifier si l'utilisateur actuel est admin
        let isAdmin = false;
        if (currentAthleteId) {
          const userDb = await query(`SELECT is_admin FROM athletes WHERE id = $1`, [currentAthleteId]);
          if (userDb.length > 0 && userDb[0].is_admin) isAdmin = true;
        }
		
        // Récupérer les segments avec leurs métadonnées depuis NOTRE base de données
        const segmentRows = await query(`
          SELECT segment_id, order_index, name, distance, elevation, grade as average_grade, sport_type as activity_type 
          FROM challenge_segments 
          WHERE challenge_id = $1 
          ORDER BY order_index ASC
        `, [id]);

        let totalDistance = 0, totalElevation = 0;
        
        const enrichedSegments = segmentRows.map((s) => {
          const dist = Number(s.distance) || 0;
          const elev = Number(s.elevation) || 0;
          totalDistance += dist;
          totalElevation += elev;
          
          return { 
            id: s.segment_id, 
            order: s.order_index, 
            name: s.name, 
            distance: dist, 
            elevation: elev, 
            average_grade: Number(s.average_grade) || 0, 
            activity_type: s.activity_type 
          };
        });

        return res.status(200).json({ 
          ...challengeRows[0], 
          is_admin: isAdmin, 
          can_edit: String(challengeRows[0].creator_id) === String(currentAthleteId), 
          total_distance: totalDistance, 
          total_elevation: totalElevation, 
          segments: enrichedSegments 
        });
      }
    }


    // ==========================================
    // DELETE : SUPPRIMER UN DÉFI
    // ==========================================
    else if (method === "DELETE") {
      if (!id || !currentAthleteId) return res.status(400).json({ error: "Missing ID or Auth" });
      const checkOwner = await query(`SELECT creator_id FROM challenges WHERE id = $1`, [id]);
      if (!checkOwner.length || String(checkOwner[0].creator_id) !== String(currentAthleteId)) return res.status(403).json({ error: "Forbidden" });

      await query(`DELETE FROM challenge_results WHERE challenge_id = $1`, [id]);
      await query(`DELETE FROM leaderboards WHERE challenge_id = $1`, [id]);
      await query(`DELETE FROM challenge_segments WHERE challenge_id = $1`, [id]);
      await query(`DELETE FROM challenges WHERE id = $1`, [id]);
      return res.status(200).json({ success: true, deleted_id: id });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
