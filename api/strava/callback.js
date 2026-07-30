// rien à importer, fetch est natif

export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  try {
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code"
      })
    });

    const data = await response.json();

    if (!data.access_token) {
      console.error("Strava token error:", data);
      return res.status(500).json({
        error: "Token exchange failed",
        details: data
      });
    }

    const isProd = req.headers.host.includes("vercel.app");

	const cookieFlags = isProd
	? "Path=/; HttpOnly; Secure; SameSite=None"
	: "Path=/; HttpOnly; SameSite=None";
	
    res.setHeader("Set-Cookie", [
	`athlete_id=${data.athlete.id}; ${cookieFlags}`,
	`strava_token=${data.access_token}; ${cookieFlags}`
	]);



    // Redirection vers la page profil
	return res.redirect("https://segseq.vercel.app/profile.html");
    } catch (err) {
    console.error("Callback crash:", err);
    return res.status(500).send("Token exchange failed");
  }
}
