import fetch from "node-fetch";

export default async function handler(req, res) {
  const token = req.cookies?.strava_token;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const athleteRes = await fetch("https://www.strava.com/api/v3/athlete", {
    headers: { Authorization: `Bearer ${token}` }
  });

  const athlete = await athleteRes.json();

  res.status(200).json(athlete);
}
