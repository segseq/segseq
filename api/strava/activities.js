import fetch from "node-fetch";

export default async function handler(req, res) {
  if (!global.accessToken) {
    return res.status(400).json({ error: "Not authenticated" });
  }

  try {
    const response = await fetch(
      "https://www.strava.com/api/v3/athlete/activities",
      {
        headers: {
          Authorization: `Bearer ${global.accessToken}`
        }
      }
    );

    const activities = await response.json();
    res.status(200).json(activities);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
}
