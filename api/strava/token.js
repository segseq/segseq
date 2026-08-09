/* ------------------------------ */
/* ./api/strava/callback.js */
/* ------------------------------ */



import { query } from "../../db.js";

/**
 * Récupère un token Strava valide pour un athlète, le rafraîchit si nécessaire.
 * @param {string} athleteId - L'ID de l'athlète dans votre base de données.
 * @returns {Promise<string|null>} - Le access_token valide ou null en cas d'erreur.
 */
export async function getValidStravaToken(athleteId) {
    const athleteRes = await query(
        'SELECT access_token, refresh_token, expires_at FROM athletes WHERE id = $1',
        [athleteId]
    );

    if (athleteRes.length === 0) {
        console.error(`Aucun athlète trouvé pour l'ID ${athleteId}`);
        return null;
    }

    let athlete = athleteRes[0];
    const nowUnix = Math.floor(Date.now() / 1000);

    // Si le token est sur le point d'expirer (ex: dans les 5 prochaines minutes) ou a expiré
    if (athlete.expires_at < (nowUnix + 300)) {
        console.log(`Token pour l'athlète ${athleteId} expiré, rafraîchissement...`);
        try {
            const response = await fetch("https://www.strava.com/oauth/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    client_id: process.env.STRAVA_CLIENT_ID,
                    client_secret: process.env.STRAVA_CLIENT_SECRET,
                    grant_type: "refresh_token",
                    refresh_token: athlete.refresh_token,
                }),
            });

            if (!response.ok) {
                throw new Error("Échec du rafraîchissement du token Strava.");
            }

            const newTokens = await response.json();

            // Mettre à jour la base de données avec les nouveaux tokens
            await query(
                `UPDATE athletes SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE id = $4`,
                [newTokens.access_token, newTokens.refresh_token, newTokens.expires_at, athleteId]
            );

            console.log(`Token pour l'athlète ${athleteId} rafraîchi avec succès.`);
            return newTokens.access_token; // Retourne le nouveau token

        } catch (error) {
            console.error("Erreur critique lors du rafraîchissement du token:", error);
            // Ici, vous pourriez avoir une logique pour notifier l'utilisateur ou invalider sa session
            return null;
        }
    }

    // Si le token est encore valide
    return athlete.access_token;
}