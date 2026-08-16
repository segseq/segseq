/* ------------------------------ */
/* ./api/challenges.js */
/* ------------------------------ */
import fs from 'fs';
import path from 'path';


// --- CONFIG ---
export const config = { api: { bodyParser: true } };

// --- IMPORTS ---
import { query } from "../db.js";
import { parse } from "cookie-es";
import jwt from "jsonwebtoken";
import { getValidStravaToken } from "./token.js";.

// --- HELPER ---
const delay = (ms) => new Promise(res => setTimeout(res, ms));

export default async function handler(req, res) {
// INJECTION SEO : Interception pour servir le HTML pré-rendu
if (req.method === 'GET' && req.query.render_html === 'true') {
  const challengeId = req.query.id;
  
  // Chemin absolu vers le fichier HTML statique dans l'environnement Vercel
  const htmlPath = path.join(process.cwd(), 'challenge.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  if (!challengeId) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  }

  try {
    // Récupérer les métadonnées du challenge 
    const { rows } = await query(
      'SELECT name, description, image_url FROM challenges WHERE id = $1', 
      [challengeId]
    );

    if (rows.length > 0) {
      const challenge = rows[0];
      const title = `${challenge.name} | SegSeq`;
      const desc = challenge.description || 'Rejoignez ce challenge sur SegSeq !';
      const imgUrl = challenge.image_url || 'https://votre-domaine-segseq.com/default-banner.jpg'; // URL de fallback

      const metaTags = `
        <title>${title}</title>
        <meta name="description" content="${desc}">
        <meta property="og:title" content="${title}">
        <meta property="og:description" content="${desc}">
        <meta property="og:image" content="${imgUrl}">
        <meta property="twitter:card" content="summary_large_image">
      `;

      // Nettoie la balise title existante pour éviter les doublons
      html = html.replace(/<title>.*<\/title>/i, ''); 
      // Injecte les nouvelles balises juste avant la fermeture du head
      html = html.replace('</head>', `${metaTags}\n</head>`);
    }

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    return res.status(200).send(html);
    
  } catch (error) {
    console.error('Erreur Injection SEO:', error);
    // En cas d'erreur DB, on sert quand même le HTML brut pour ne pas bloquer l'utilisateur
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html); 
  }
}

	
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
      
       const { name, description, duration, strict_sequence, segments, image_url, is_featured, start_date, end_date } = req.body;
      
      if (!name || !Array.isArray(segments) || segments.length < 2) {
        return res.status(400).json({ error: "Invalid payload: Missing name or segments" });
      }
      if (start_date && !end_date) {
        return res.status(400).json({ error: "Si une date de début est définie, la date de fin est obligatoire." });
      }
      if (!duration && (!start_date || !end_date)) {
        return res.status(400).json({ error: "Vous devez définir soit une durée, soit des dates de début et de fin." });
      }

      const rows = await query(
        `INSERT INTO challenges (creator_id, name, description, duration_hours, strict_sequence, image_url, is_featured, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [currentAthleteId, name, description, duration || null, strict_sequence, image_url, is_featured || false, start_date || null, end_date || null]
      );


      const challengeId = rows[0].id;

      // Récupérer le token de l'utilisateur pour fetch les métadonnées
      let token = null;
		try {
		  token = await getValidStravaToken(currentAthleteId);
		} catch (e) {
		  console.error("Erreur récupération token pour création/édition:", e);
		}


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
      
        const { id, name, description, duration, strict_sequence, segments, image_url, is_featured, start_date, end_date } = req.body;
      
      // NOUVELLES RÈGLES DE VALIDATION
      if (!id || !name || !Array.isArray(segments) || segments.length < 2) {
        return res.status(400).json({ error: "Invalid payload" });
      }
      if (start_date && !end_date) {
        return res.status(400).json({ error: "Si une date de début est définie, la date de fin est obligatoire." });
      }
      if (!duration && (!start_date || !end_date)) {
        return res.status(400).json({ error: "Vous devez définir soit une durée, soit des dates de début et de fin." });
      }

      // ... (Vérification du checkOwner) ...

	const checkOwner = await query(`SELECT creator_id FROM challenges WHERE id = $1`, [id]);

	if (checkOwner.length === 0 || String(checkOwner[0].creator_id) !== String(currentAthleteId)) {
    return res.status(403).json({ error: "Forbidden: You are not the owner of this challenge" });
	}

      await query(
        `UPDATE challenges SET name = $1, description = $2, duration_hours = $3, strict_sequence = $4, image_url = $5, is_featured = $6, start_date = $7, end_date = $8 WHERE id = $9`,
        [name, description, duration || null, strict_sequence, image_url, is_featured || false, start_date || null, end_date || null, id]
      );




         // 2. Remplacer les segments (Fetch Strava pour les métadonnées)
      await query(`DELETE FROM challenge_segments WHERE challenge_id = $1`, [id]);
      
      let token = null;
		try {
		  token = await getValidStravaToken(currentAthleteId);
		} catch (e) {
		  console.error("Erreur récupération token pour création/édition:", e);
		}

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
         // Liste des défis (pour explore.html)
        const rows = await query(`
          SELECT c.id, c.creator_id, c.name, c.description, c.duration_hours, c.created_at, c.image_url, c.is_featured, c.start_date, c.end_date, 
                 ARRAY_AGG(DISTINCT cs.sport_type) as sports,
                 COUNT(cs.segment_id) as segment_count
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
		
        // Récupérer les segments (on ajoute "id as row_id" pour pouvoir les mettre à jour si besoin)
        let segmentRows = await query(`
          SELECT id as row_id, segment_id, order_index, name, distance, elevation, grade as average_grade, sport_type as activity_type 
          FROM challenge_segments 
          WHERE challenge_id = $1 
          ORDER BY order_index ASC
        `, [id]);

        // --- AUTO-GUÉRISON (SELF-HEALING) POUR LES ANCIENS DÉFIS ---
        // Si on détecte un ancien segment sans nom, on va le chercher sur Strava et on met à jour la DB
        const needsBackfill = segmentRows.some(s => s.name === null);
        
        if (needsBackfill) {
          // On récupère le token du créateur pour avoir le droit d'interroger Strava
          const creatorDb = await query(`SELECT access_token FROM athletes WHERE id = $1`, [challengeRows[0].creator_id]);
          const token = creatorDb.length > 0 ? creatorDb[0].access_token : null;

          if (token) {
            for (let i = 0; i < segmentRows.length; i++) {
              if (segmentRows[i].name === null) {
                try {
                  const res = await fetch(`https://www.strava.com/api/v3/segments/${segmentRows[i].segment_id}`, { headers: { Authorization: `Bearer ${token}` } });
                  if (res.ok) {
                    const data = await res.json();
                    
                    // 1. Mettre à jour la base de données pour toujours
                    await query(
                      `UPDATE challenge_segments SET name=$1, distance=$2, elevation=$3, grade=$4, sport_type=$5 WHERE id=$6`,
                      [data.name, data.distance || 0, data.total_elevation_gain || 0, data.average_grade || 0, data.activity_type, segmentRows[i].row_id]
                    );
                    
                    // 2. Mettre à jour l'objet en mémoire pour l'affichage immédiat
                    segmentRows[i].name = data.name;
                    segmentRows[i].distance = data.distance || 0;
                    segmentRows[i].elevation = data.total_elevation_gain || 0;
                    segmentRows[i].average_grade = data.average_grade || 0;
                    segmentRows[i].activity_type = data.activity_type;
                  }
                } catch(e) { console.error("Erreur auto-guérison Strava:", e); }
              }
            }
          }
        }

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
