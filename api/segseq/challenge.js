import { query } from "../../db.js";

export default async function handler(req, res) {
  const { method } = req;
  const id = req.query.id;

  try {
    // ==========================================
    // HANDLE GET REQUESTS (Read)
    // ==========================================
    if (method === "GET") {
      
      // 1A. GET ALL CHALLENGES (For Explore Page)
      if (!id) {
        const rows = await query(`
          SELECT id, name, sport, duration_hours, created_at 
          FROM challenges 
          ORDER BY created_at DESC
        `);
        return res.status(200).json(rows);
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

        // Return clean object (Mock leaderboard removed)
        return res.status(200).json({
          id: challenge.id,
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

      // 1. Delete associated results
      await query(`DELETE FROM challenge_results WHERE challenge_id = $1`, [id]);
      
      // 2. Delete associated segments mapping
      await query(`DELETE FROM challenge_segments WHERE challenge_id = $1`, [id]);
      
      // 3. Delete the challenge itself
      const result = await query(`DELETE FROM challenges WHERE id = $1 RETURNING id`, [id]);

      if (result.length === 0) {
        return res.status(404).json({ error: "Challenge not found" });
      }

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