export default async function handler(req, res) {
  // Lire le cookie manuellement
  const cookieHeader = req.headers.cookie || "";
  const token = cookieHeader
    .split(";")
    .map(c => c.trim())
    .find(c => c.startsWith("strava_token="))
    ?.split("=")[1];

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const athleteRes = await fetch("https://www.strava.com/api/v3/athlete", {
      headers: { Authorization: `Bearer ${token}` }
    });

    const athlete = await athleteRes.json();

    return res.status(200).json(athlete);
  } catch (err) {
    console.error("Athlete fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch athlete" });
  }
}
