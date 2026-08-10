import { query } from "../db.js";
import { calculateLeaderboard } from "./leaderboard.js";
import { getValidStravaToken } from './strava/token.js';

// Fonction utilitaire pour le délai entre les appels API
const delay = (ms) => new Promise(res => setTimeout(res, ms));

/**
 * Handler principal pour le backfill manuel des efforts d'un athlète.
 * Cette fonction contient la logique complète pour s'adapter aux permissions
 * et au statut d'abonnement de l'utilisateur.
 */
export default async function handler(req, res) {
  const athleteId = req.query.athlete_id;
  let debugLog = [];

  const logStep = (message) => {
    console.log(message);
    debugLog.push(message);
  };

  if (!athleteId) {
    return res.status(400).json({ error: "Veuillez fournir un athlete_id" });
  }

  try {
    logStep(`Lancement du backfill pour l'athlète ID: ${athleteId}`);

    // --- Étape 1 : Récupération des informations de l'athlète ---
    const athletes = await query(`SELECT *, scope, premium FROM athletes WHERE id = $1`, [athleteId]);
    if (athletes.length === 0) {
      logStep(`X Erreur: Athlète avec l'ID ${athleteId} introuvable.`);
      return res.status(404).json({ error: "Athlète introuvable", debug: debugLog });
    }
    const athlete = athletes[0];
    const athleteName = `${athlete.firstname || ''} ${athlete.lastname || ''}`.trim();
    logStep(`Athlète trouvé: ${athleteName}`);

    // --- Étape 2 : Obtention d'un token Strava valide ---
    logStep("Vérification de la validité du token Strava...");
    const accessToken = await getValidStravaToken(athlete.id);
    if (!accessToken) {
      logStep("! Échec de l'obtention d'un token Strava valide. Le rafraîchissement a peut-être échoué. Arrêt.");
      return res.status(500).json({ error: "Failed to get a valid Strava token.", debug: debugLog });
    }
    logStep("Token Strava valide obtenu.");

    const athleteScope = athlete.scope || '';
    const hasReadAllScope = athleteScope.includes('activity:read_all');
    logStep(`Permissions accordées (Scope): "${athleteScope}"`);

    const allAppSegments = await query(`SELECT DISTINCT segment_id FROM challenge_segments`);
    const allAppSegmentIds = new Set(allAppSegments.map(s => s.segment_id.toString()));
    let totalInserted = 0;
    let rateLimitHit = false;

    // =================================================================
    // ÉTAPE 3 : ARCHITECTURE DE DÉCISION DU BACKFILL
    // =================================================================

  // RÈGLE STRICTE : On ne collecte aucune donnée passée pour les comptes gratuits
    if (!athlete.premium) {
      logStep("-> Statut: Gratuit. Conformément aux règles, aucune donnée passée n'est collectée.");
      return res.status(200).json({ success: true, message: "Skipped backfill for free user", debug: debugLog });
    }

    // À partir d'ici, l'utilisateur est obligatoirement Premium
    if (hasReadAllScope) {
      // --- CAS A : PREMIUM + FULL SCOPE ---
      logStep(`--> Statut: Premium avec accès privé. Récupération de tous les efforts.`);
      for (const segmentId of allAppSegmentIds) {
        if (rateLimitHit) break;
        try {
          const effortsRes = await fetch(`https://www.strava.com/api/v3/segment_efforts?segment_id=${segmentId}&athlete_id=${athlete.id}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          if (effortsRes.ok) {
            const efforts = await effortsRes.json();
            if (efforts.length > 0) {
              logStep(`--> Trouvé ${efforts.length} effort(s) pour le segment ${segmentId}.`);
              for (const effort of efforts) {
                const resDb = await query(`INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (effort_id) DO NOTHING RETURNING id`, [effort.id, effort.segment.id, athlete.id, athleteName, effort.start_date_local || effort.start_date, effort.elapsed_time]);
                if (resDb.length > 0) totalInserted++;
              }
            }
          } else {
            logStep(`X Erreur API (${effortsRes.status}) pour le segment ${segmentId}: ${effortsRes.statusText}`);
            if (effortsRes.status === 429) { rateLimitHit = true; }
          }
        } catch (err) { logStep(`X Erreur critique sur le segment ${segmentId}: ${err.message}`); }
        await delay(250);
      }
    } else {
      // --- CAS B : PREMIUM + PUBLIC ONLY ---
      logStep("! Permission 'activity:read_all' non accordée. Récupération des efforts publics uniquement.");
      for (const segmentId of allAppSegmentIds) {
        if (rateLimitHit) break;
        try {
          const effortsRes = await fetch(`https://www.strava.com/api/v3/segment_efforts?segment_id=${segmentId}&athlete_id=${athlete.id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
          if (effortsRes.ok) {
            const efforts = await effortsRes.json();
            if (efforts.length > 0) {
              logStep(`--> Trouvé ${efforts.length} effort(s) public(s) pour le segment ${segmentId}.`);
              for (const effort of efforts) {
                const resDb = await query(`INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (effort_id) DO NOTHING RETURNING id`, [effort.id, effort.segment.id, athlete.id, athleteName, effort.start_date_local || effort.start_date, effort.elapsed_time]);
                if (resDb.length > 0) totalInserted++;
              }
            }
          } else {
            if (effortsRes.status === 429) { rateLimitHit = true; }
          }
        } catch (err) { logStep(`X Erreur critique: ${err.message}`); }
        await delay(250);
      }
    }


    // --- Étape 4 : Finalisation et recalcul ---
    logStep(`Backfill terminé. Total efforts insérés: ${totalInserted}`);
    if (totalInserted > 0) {
      logStep("Recalcul des classements en cours...");
      const allChallenges = await query(`SELECT id FROM challenges`);
      const allAthletesForCalc = await query(`SELECT id, firstname, lastname, profile, sex FROM athletes`);
      for (const challenge of allChallenges) {
        await calculateLeaderboard(challenge.id, allAthletesForCalc, () => {});
      }
      logStep(`Classements recalculés pour ${allChallenges.length} défis.`);
    } else {
      logStep("Aucun nouvel effort trouvé, pas de recalcul nécessaire.");
    }

    return res.status(200).json({ success: true, debug: debugLog });

  } catch (error) {
    console.error("Erreur globale dans admin-backfill:", error);
    logStep(`X ERREUR GLOBALE: ${error.message}`);
    return res.status(500).json({ error: error.message, debug: debugLog });
  }
}
