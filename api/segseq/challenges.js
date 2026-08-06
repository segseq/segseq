// --- CONFIG : activer le parsing JSON dans Vercel ---
export const config = {
  api: {
    bodyParser: true,
  },
};

// --- IMPORTS ---
import { query } from "../../db.js";
import { parse } from "cookie-es";
import jwt from "jsonwebtoken"; // NOUVEL IMPORT

// --- HANDLER ---
export default async function handler(req, res) {
  console.log("REQ BODY:", req.body);
  
  // --- METHOD CHECK ---
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // --- COOKIE PARSING & SECURITY CHECK ---
  const cookies = parse(req.headers.cookie || "");
  const sessionToken = cookies.session;
  let creatorId = null;

  if (!sessionToken) {
    return res.status(401).json({ error: "Not authenticated: Missing session" });
  }

  try {
    // Vérification cryptographique de l'identité
    const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
    creatorId = decoded.athleteId;
  } catch (err) {
    console.error("Invalid session:", err.message);
    return res.status(401).json({ error: "Not authenticated: Invalid or expired session" });
  }

  // --- PAYLOAD EXTRACTION ---
  const { name, description, sport, duration, strict_sequence, segments } = req.body;

  // --- VALIDATION ---
  if (!name || !sport || !duration || !Array.isArray(segments) || segments.length < 2) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    // --- INSERT CHALLENGE ---
    const rows = await query(
      `INSERT INTO challenges (creator_id, name, description, sport, duration_hours, strict_sequence)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [creatorId, name, description, sport, duration, strict_sequence]
    );

    const challengeId = rows[0].id;

    // --- INSERT SEGMENTS ---
    for (let i = 0; i < segments.length; i++) {
      await query(
        `INSERT INTO challenge_segments (challenge_id, segment_id, order_index)
         VALUES ($1, $2, $3)`,
        [challengeId, segments[i], i + 1]
      );
    }

    // --- SUCCESS ---
    return res.status(200).json({ id: challengeId });

  } catch (err) {
    console.error("DB error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
}
