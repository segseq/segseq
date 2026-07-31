import { query } from "../../db.js";
import { parse } from "cookie-es"; // Needed to read the user's cookie

export default async function handler(req, res) {
  const { method } = req;
  const id = req.query.id;

  // Parse cookies to get the current logged-in user
  const cookies = parse(req.headers.cookie || "");
  const currentAthleteId = cookies.athlete_id;

  try {
    // ==========================================
    // HANDLE GET REQUESTS (Read)
    // ==========================================
    if (method === "GET") {
      
      // 1A. GET ALL CHALLENGES (For Explore Page)
      if (!id) {
        const rows = await query(`
          SELECT id, creator_id, name, sport, duration_hours, created_at 
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
        const challengeRows = await query(
          `SELECT id, creator_id, name, description, sport, duration_hours
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

        return res.status(200).json({
          id: challenge.id,
          creator_id: challenge.creator_id,
          name: challenge.name,
          description: challenge.description,
          sport: challenge.sport,
          duration: challenge.duration_hours,
          segments: segmentRows.map(s => ({
            id: s.segment_id,
            order: s.order_index
          }))
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

      // SECURITY CHECK: Verify the user requesting the delete is the creator
      const checkOwner = await query(`SELECT creator_id FROM challenges WHERE id = $1`, [id]);
      
      if (checkOwner.length === 0) {
        return res.status(404).json({ error: "Challenge not found" });
      }

      if (String(checkOwner[0].creator_id) !== String(currentAthleteId)) {
        return res.status(403).json({ error: "Forbidden: You can only delete challenges you created." });
      }

      // If we pass the security check, proceed with deletion
      await query(`DELETE FROM challenge_results WHERE challenge_id = $1`, [id]);
      await query(`DELETE FROM challenge_segments WHERE challenge_id = $1`, [id]);
      const result = await query(`DELETE FROM challenges WHERE id = $1 RETURNING id`, [id]);

      return res.status(200).json({ success: true, deleted_id: id });
    } 
    
    // ==========================================
    // METHOD NOT ALLOWED
    // ==========================================
    else {
      return res.status(405).json({ error: "Method not allowed" });
    }

  } catch (err) {
    console.error("DB error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}