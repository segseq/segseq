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

function addSeconds(date, sec) {
  return new Date(date.getTime() + sec * 1000);
}

// construit une réalisation valide du segseq pour un athlète
function findValidSegSeqCompletion(segmentIds, effortsBySegment, durationHoursLimit) {

  console.log("=== DEBUG: Checking athlete segments ===");
  console.log("Segment IDs:", segmentIds);
  console.log("Efforts by segment:", Object.keys(effortsBySegment));

  if (segmentIds.some(id => !effortsBySegment[id] || effortsBySegment[id].length === 0)) {
    console.log(">>> DEBUG: Missing segment efforts, athlete eliminated");
    return null;
  }

  const firstSegmentId = segmentIds[0];
  const firstEfforts = effortsBySegment[firstSegmentId];

  let bestCompletion = null;

  for (const startEffort of firstEfforts) {

    console.log("=== DEBUG: Trying start effort ===");
    console.log("Start segment:", firstSegmentId);
    console.log("Activity:", startEffort.activity.id);
    console.log("Start date:", startEffort.start_date);

    const usedActivities = new Set();
    const sequenceEfforts = [];

    const startActivityId = startEffort.activity.id;
    const startDate = new Date(startEffort.start_date);
    const startEnd = addSeconds(startDate, startEffort.elapsed_time);

    usedActivities.add(startActivityId);
    sequenceEfforts.push(startEffort);

    let prevEnd = startEnd;
    let valid = true;

    for (let i = 1; i < segmentIds.length; i++) {
      const segId = segmentIds[i];
      const efforts = effortsBySegment[segId];

      const sorted = efforts.slice().sort(
        (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
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
        console.log(">>> DEBUG: No valid effort found for segment", segId);
        valid = false;
        break;
      }

      const chosenStart = new Date(chosen.start_date);
      const chosenEnd = addSeconds(chosenStart, chosen.elapsed_time);

      usedActivities.add(chosen.activity.id);
      sequenceEfforts.push(chosen);
      prevEnd = chosenEnd;

      console.log("Segment", segId, "chosen effort:");
      console.log("  Activity:", chosen.activity.id);
      console.log("  Start:", chosen.start_date);
    }

    if (!valid) continue;

    const endEffort = sequenceEfforts[sequenceEfforts.length - 1];
    const endStart = new Date(endEffort.start_date);
    const endTime = addSeconds(endStart, endEffort.elapsed_time);

    const durationHours = (endTime.getTime() - startDate.getTime()) / 1000 / 3600;

    console.log("=== DEBUG: Duration check ===");
    console.log("Duration hours:", durationHours);
    console.log("Limit:", durationHoursLimit);

    if (durationHours > durationHoursLimit) {
      console.log(">>> DEBUG: Duration too long, athlete eliminated");
      continue;
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

  if (!bestCompletion) {
    console.log(">>> DEBUG: Athlete has NO valid segseq completion");
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
    const challengeRows = await query(
      `SELECT duration_hours
       FROM challenges
       WHERE id = $1`,
      [challengeId]
    );

    if (challengeRows.length === 0) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const durationHoursLimit = challengeRows[0].duration_hours;

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

    const t0 = Date.now();

    const segmentEffortsBySegment = {};

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
        segmentEffortsBySegment