/* ------------------------------ */
/* ./api/stats.js */
/* ------------------------------ */

import { query } from "../db.js";
import { parse } from "cookie-es";
import jwt from "jsonwebtoken";

export default async function handler(req, res) {
  // INJECTION SEO : Interception pour le Sitemap dynamique
  if (req.query.sitemap === 'true') {
    try {
      // CORRECTION : utilisation de query() au lieu de pool.query()
      const rows = await query('SELECT id FROM challenges'); 
      
      // Définissez votre domaine principal ici
      const baseUrl = 'https://www.segseq.com'; 
      
      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
      
      // Pages statiques
      xml += `\n  <url><loc>${baseUrl}/</loc><changefreq>weekly</changefreq></url>`;
      xml += `\n  <url><loc>${baseUrl}/explore.html</loc><changefreq>daily</changefreq></url>`;
      
      // Pages dynamiques (Challenges)
      rows.forEach(row => {
        xml += `\n  <url><loc>${baseUrl}/challenge.html?id=${row.id}</loc><changefreq>daily</changefreq></url>`;
      });
      
      xml += '\n</urlset>';

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate'); // Cache Vercel
      return res.status(200).send(xml);
    } catch (error) {
      console.error('Erreur Sitemap:', error);
      return res.status(500).send('Erreur génération sitemap');
    }
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const scope = req.query.scope;

  try {
    // --- CAS 1 : STATISTIQUES PERSONNELLES (Profil) ---
    if (scope === "me") {
      const cookies = parse(req.headers.cookie || "");
      const sessionToken = cookies.session;

      if (!sessionToken) return res.status(401).json({ error: "Non authentifié" });

      const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
      const athleteId = decoded.athleteId;

      const createdRes = await query(`SELECT COUNT(*) as count FROM challenges WHERE creator_id = $1`, [athleteId]);
      const completedRes = await query(`SELECT COUNT(DISTINCT challenge_id) as count FROM challenge_results WHERE athlete_id = $1`, [athleteId]);
      const effortsRes = await query(`SELECT COUNT(*) as count FROM segment_efforts WHERE athlete_id = $1`, [athleteId]);
      const victoriesRes = await query(`SELECT COUNT(*) as count FROM challenge_results WHERE athlete_id = $1 AND rank = 1`, [athleteId]);

      return res.status(200).json({
        created: parseInt(createdRes[0].count, 10),
        completed: parseInt(completedRes[0].count, 10),
        efforts: parseInt(effortsRes[0].count, 10),
        victories: parseInt(victoriesRes[0].count, 10),
      });
    } 
    
    // --- CAS 2 : STATISTIQUES GLOBALES (Explore) ---
    else {
      const athletesRes = await query(`SELECT COUNT(*) as count FROM athletes`);
      const challengesRes = await query(`SELECT COUNT(*) as count FROM challenges`);
      
      // CORRECTION : Ajout du cast ::int[] pour éviter l'erreur PostgreSQL
      const featuredData = await query(`
        SELECT c.name, COUNT(a.id) as count  
        FROM challenges c  
        LEFT JOIN athletes a ON c.id = ANY(a.restricted_challenge_ids::int[])  
        WHERE c.is_featured = true  
        GROUP BY c.id, c.name  
        ORDER BY count DESC
      `);

      return res.status(200).json({
        athletes: parseInt(athletesRes[0].count, 10),
        challenges: parseInt(challengesRes[0].count, 10), // CORRECTION : La virgule manquante était ici !
        featured_count: featuredData.length,
        featured_breakdown: featuredData
      });
    }

  } catch (err) {
    console.error("Erreur stats:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
