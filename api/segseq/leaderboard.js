import { query } from "../../db.js";

// TTL du cache en heures
const TTL_HOURS = 24;

function parseCookie(header = "") {
  const out = {};
  header.split(";").forEach(part => {
    const [k, v] = part.split("=").map(s => s && s.trim());
    if (k) out[k] = v || "";
  });
  return out;
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

// utilitaire: ajoute des secondes à une date
function addSeconds(date, sec) {
  return new Date(date.getTime() + sec * 1000);
}

// construit une réalisation valide du segseq pour un athlète
function findValidSegSeqCompletion(segmentIds, effortsBySegment, maxDurationHours) {
  // effortsBySegment: { segmentId: [efforts pour cet athlète] }
  if (segmentIds.some(id => !effortsBySegment[id] || effortsBySegment[id].length === 0)) {
    return null; // manque au moins un segment
  }

  const firstSegmentId = segmentIds[0];
  const firstEfforts = effortsBySegment[firstSegmentId];

  let bestCompletion = null;

  // on essaie chaque effort du premier segment comme point de départ
  for (const startEffort of firstEfforts) {
    const usedActivities = new Set();
    const sequenceEfforts = [];

    const startActivityId = startEffort.activity.id;
    const startDate = new Date(startEffort.start_date);
    const startEnd = addSeconds(startDate, startEffort.elapsed_time);

    usedActivities.add(startActivityId);
    sequenceEfforts.push(startEffort);

    let prevEnd = startEnd;
    let valid = true;

    // pour chaque segment suivant, on cherche un effort dans une activité différente,
    // qui commence après le segment précédent (ordre temporel)
    for (let i = 1; i < segmentIds.length; i++) {
      const segId = segmentIds[i];
      const efforts = effortsBySegment[segId];

      // trier par start_date pour trouver le plus tôt possible
      const sorted = efforts
        .slice()
        .sort(
          (a, b) =>
            new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
        );

      let chosen = null;
      for (const e of sorted) {
        const actId = e.activity.id;
        const eStart = new Date(e.start_date);

        if (!usedActivities.has(actId) && eStart >= prevEnd) {
          chosen = e;
          break;
        }
      }

      if (!chosen) {
        valid = false;
        break;
      }

      const chosenStart = new Date(chosen.start_date);
      const chosenEnd = addSeconds(chosenStart, chosen.elapsed_time);

      usedActivities.add(chosen.activity.id);
      sequenceEfforts.push(chosen);
      prevEnd = chosenEnd;
    }

    if (!valid) continue;

    const endEffort = sequenceEfforts[sequenceEfforts.length - 1];
    const endStart = new Date(endEffort.start_date);
    const endTime = addSeconds(endStart, endEffort.elapsed_time);

    const durationHours =
      (endTime.getTime() - startDate.getTime()) / 1000 / 3600;

    if (durationHours > maxDurationHours) {
      continue; // ne respecte pas la durée max du challenge
    }

    const totalSeconds = sequenceEfforts.reduce(
      (sum, e) => sum + e.elapsed_time,
      0
    );

    if (!bestCompletion || totalSeconds < bestCompletion.totalSeconds) {
      bestCompletion = {
        totalSeconds,
        durationHours,
        efforts: sequenceEfforts
      };
    }
  }

  return bestCompletion;
}

export default async function handler(req, res) {
  const challengeId = req.query.id;
  const force = req.query.force === "1";

  if (!challengeId) {
    return res.status(400).json({ error: "Missing challenge id" });
  }

  const cookies = parseCookie(req.headers.cookie || "");
  const token = cookies.strava_token;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    //
    // 0. Charger la durée max du challenge (en heures)
    //
    const challengeRows = await query(
      `SELECT max_duration_hours
       FROM challenges
       WHERE id = $1`,
      [challengeId]
    );

    if (challengeRows.length === 0) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const maxDurationHours = challengeRows[0].max_duration_hours;

    //
    // 1. Vérifier si un leaderboard existe déjà (cache)
    //
    const existing = await query(
      `SELECT data, updated_at
       FROM leaderboards
       WHERE challenge_id = $1`,
      [challengeId]
    );

    let shouldRecompute = force;

    if (!force && existing.length > 0) {
      const updatedAt = new Date(existing[0].updated_at);
      const ageHours = (Date.now() - updatedAt.getTime()) / 1000 / 3600;

      if (ageHours < TTL_HOURS) {
        const cached = existing[0].data;
        return res.status(200).json({
          ...cached,
          meta: {
            source: "cache",
            cache_age_hours: ageHours,
            calculation_status: "idle"
          }
        });
      } else {
        shouldRecompute = true;
      }
    } else {
      shouldRecompute = true;
    }

    //
    // 2. Récupérer les segments du challenge (segseq)
    //
    const segments = await query(
      `SELECT segment_id
       FROM challenge_segments
       WHERE challenge_id = $1
       ORDER BY order_index ASC`,
      [challengeId]
    );

    if (segments.length === 0) {
      return res.status(400).json({ error: "Challenge has no segments" });
    }

    const segmentIds = segments.map(s => s.segment_id);

    //
    // 3. Si on doit recalculer, on le fait maintenant
    //
    const t0 = Date.now();

    const segmentEffortsBySegment = {}; // segment_id -> [efforts]

    for (const segId of segmentIds) {
      const effortsRes = await fetch(
        `https://www.strava.com/api/v3/segments/${segId}/all_efforts`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const text = await effortsRes.text();

      let efforts;
      try {
        efforts = JSON.parse(text);
      } catch (e) {
        console.error("Strava returned non‑JSON:", text);
        segmentEffortsBySegment[segId] = [];
        continue;
      }

      if (Array.isArray(efforts)) {
        segmentEffortsBySegment[segId] = efforts;
      } else {
        segmentEffortsBySegment[segId] = [];
      }
    }

    //
    // 4. Regrouper les efforts par athlète et par segment
    //
    const effortsByAthlete = {}; // athlete_id -> { name, segments: { segId: [efforts] } }

    for (const segId of segmentIds) {
      const effortList = segmentEffortsBySegment[segId] || [];
      for (const effort of effortList) {
        const athleteId = effort.athlete.id;
        const name = effort.athlete.name;

        if (!effortsByAthlete[athleteId]) {
          effortsByAthlete[athleteId] = {
            name,
            segments: {}
          };
        }

        if (!effortsByAthlete[athleteId].segments[segId]) {
          effortsByAthlete[athleteId].segments[segId] = [];
        }

        effortsByAthlete[athleteId].segments[segId].push(effort);
      }
    }

    //
    // 5. Pour chaque athlète, chercher une réalisation valide du segseq
    //    - chaque segment dans une activité distincte
    //    - segments dans l'ordre temporel
    //    - durée totale <= maxDurationHours
    //
    const leaderboardRows = [];

    for (const [athleteId, data] of Object.entries(effortsByAthlete)) {
      const completion = findValidSegSeqCompletion(
        segmentIds,
        data.segments,
        maxDurationHours
      );

      if (!completion) continue;

      leaderboardRows.push({
        athlete_id: athleteId,
        athlete: data.name,
        time_seconds: completion.totalSeconds,
        time_human: formatTime(completion.totalSeconds),
        challenge_duration_hours: completion.durationHours
      });
    }

    //
    // 6. Trier le leaderboard par temps total
    //
    const leaderboard = leaderboardRows
      .sort((a, b) => a.time_seconds - b.time_seconds)
      .map((row, index) => ({
        rank: index + 1,
        ...row
      }));

    const t1 = Date.now();
    const calcMs = t1 - t0;

    const finalData = {
      leaderboard,
      meta: {
        source: "fresh",
        calculation_status: "completed",
        calculation_time_ms: calcMs,
        max_duration_hours: maxDurationHours
      }
    };

    //
    // 7. Stocker en BD (upsert)
    //
    await query(
      `INSERT INTO leaderboards (challenge_id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (challenge_id)
       DO UPDATE SET data = $2, updated_at = NOW()`,
      [challengeId, finalData]
    );

    //
    // 8. Retourner le leaderboard
    //
    return res.status(200).json(finalData);

  } catch (err) {
    console.error("Leaderboard error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
