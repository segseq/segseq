// api/segseq/validate-segment.js
export default async function handler(req, res) {
  const segmentId = req.query.id;
  if (!segmentId) return res.status(400).json({ error: "Missing segment ID" });

  try {
    // Note: Utilise le token d'un athlète admin (ou de l'utilisateur connecté) pour faire cet appel
    // Pour l'exemple, on utilise une variable d'environnement contenant un token valide
    const token = process.env.STRAVA_ADMIN_TOKEN; 

    const stravaRes = await fetch(`https://www.strava.com/api/v3/segments/${segmentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!stravaRes.ok) {
      return res.status(404).json({ error: "Segment introuvable ou privé." });
    }

    const data = await stravaRes.json();
    return res.status(200).json({ name: data.name, distance: data.distance });

  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur" });
  }
}