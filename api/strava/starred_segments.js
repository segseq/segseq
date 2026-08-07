export default async function handler(req, res) {
  try {
    // Récupérer le token Strava depuis les cookies
    const cookies = req.headers.cookie || '';
    const tokenMatch = cookies.match(/strava_token=([^;]+)/);
    
    if (!tokenMatch) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const accessToken = tokenMatch[1];

    // Appel à l'API Strava (récupère les segments étoilés)
    // Note : Strava pagine les résultats. Ici on prend la page 1 (jusqu'à 200 segments).
    const stravaRes = await fetch("https://www.strava.com/api/v3/segments/starred?page=1&per_page=200", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!stravaRes.ok) {
      throw new Error("Erreur lors de la communication avec Strava");
    }

    const segments = await stravaRes.json();
    
    // On renvoie un tableau simplifié pour le frontend
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