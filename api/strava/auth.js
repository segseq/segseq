/* ------------------------------ */
/* ./api/strava/auth.js */
/* ------------------------------ */

export default function handler(req, res) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const redirectUri = process.env.STRAVA_REDIRECT_URI;
  const sourceChallenge = req.query.source_challenge; // NOUVEAU

  const authUrl = new URL('https://www.strava.com/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'read,activity:read_all');
  
  if (sourceChallenge) {
    authUrl.searchParams.set('state', sourceChallenge); // NOUVEAU : On passe l'ID
  }

  res.redirect(authUrl.toString());
}
