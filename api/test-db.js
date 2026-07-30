import { query } from "../db.js";

export default async function handler(req, res) {
  try {
    const rows = await query("SELECT NOW()");
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
}
