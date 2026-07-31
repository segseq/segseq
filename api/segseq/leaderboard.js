import { query } from "../../db.js";

// --- HELPERS ---
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

// --- HANDLER ---
export default async function handler(req, res) {
  const challengeId = req.query.id;
  const force = req.query.force === "1";

  if (!challengeId) return res.status(400).json({ error: "Missing challenge id" });

  const cookies = parseCookie(req.headers.cookie || "");
  const token = cookies.strava_token;

  if (force && !token) {
    return res.status(401).json({ error: "Not authenticated with Strava to refresh data." });
  }

  try {
    let debugSteps = [];
    const logStep = (msg) => debugSteps.push(`> ${msg}`);

    // 1. Get Challenge Limits & Segments
    const challengeRows = await query(`SELECT duration_hours FROM challenges WHERE id = $1`, [challengeId]);
    if (challengeRows.length === 0) return res.status(404).json({ error: "Challenge not found" });
    const durationHoursLimit = challengeRows[0].duration_hours;

    const segmentsRows = await query(
      `SELECT segment_id FROM challenge_segments WHERE challenge_id = $1 ORDER BY order_index ASC`,
      [challengeId]
    );
    if (segmentsRows.length === 0) return res.status(400).json({ error: "Challenge has no segments" });
    
    const reqSegIds = segmentsRows.map(s => s.segment_id);

    // ==========================================
    // PHASE 1: SYNC STRAVA DATA TO LOCAL DB
    // ==========================================
    if (force) {
      logStep("🔄 Force refresh requested. Syncing Strava public leaderboards to local DB...");
      for (const segId of reqSegIds) {
        const lbRes = await fetch(`https://www.strava.com/api/v3/segments/${segId}/leaderboard`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        if (lbRes.ok) {
          const lbData = await lbRes.json();
          if (lbData.entries) {
            let inserted = 0;
            for (const entry of lbData.entries) {
              // UPSERT into local database
              const res = await query(`
                INSERT INTO segment_efforts (segment_id, athlete_name, start_date, elapsed_time)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (segment_id, athlete_name, start_date) DO NOTHING
                RETURNING id;
              `, [segId, entry.athlete_name, entry.start_date_local, entry.elapsed_time]);
              if (res.length > 0) inserted++;
            }
            logStep(`  - Segment ${segId}: Synced ${lbData.entries.length} efforts (${inserted} new).`);
          }
        } else {
          logStep(`  - ⚠️ Failed to fetch Strava data for Segment ${segId}. Rate limited?`);
        }
      }
    } else {
      logStep("⚡ Loading data from local Database (No Strava API calls used).");
    }

    // ==========================================
    // PHASE 2: EVALUATE LOGIC STEP-BY-STEP
    // ==========================================
    
    // Fetch all relevant efforts from our local DB
    const efforts = await query(
      `SELECT segment_id, athlete_name, start_date, elapsed_time 
       FROM segment_efforts WHERE segment_id = ANY($1::bigint[])`,
      [reqSegIds]
    );

    // Group efforts by athlete
    const athletes = {};
    const segmentCounts = {};
    reqSegIds.forEach(id => segmentCounts[id] = new Set());

    efforts.forEach(e => {
      if (!athletes[e.athlete_name]) athletes[e.athlete_name] = [];
      athletes[e.athlete_name].push(e);
      segmentCounts[e.segment_id].add(e.athlete_name);
    });

    logStep(`📊 --- STEP 1: Unique Athletes per Segment ---`);
    reqSegIds.forEach((id, idx) => {
      logStep(`  - Segment ${idx + 1} (${id}): ${segmentCounts[id].size} athletes`);
    });

    let completedAllCount = 0;
    let sequenceValidCount = 0;
    let durationValidCount = 0;
    let finalLeaderboard = [];

    logStep(`📊 --- STEP 2 to 4: Evaluating ${Object.keys(athletes).length} Total Athletes ---`);

    for (const [athName, athEfforts] of Object.entries(athletes)) {
      // Step 2: Did they complete ALL segments?
      const uniqueSegs = new Set(athEfforts.map(e => e.segment_id));
      if (uniqueSegs.size < reqSegIds.length) continue; 
      completedAllCount++;

      // Step 3: Did they complete them in the correct SEQUENCE?
      athEfforts.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
      
      let expectedIdx = 0;
      let validSequence = [];
      
      for (const e of athEfforts) {
        if (e.segment_id == reqSegIds[expectedIdx]) {
          validSequence.push(e);
          expectedIdx++;
          if (expectedIdx === reqSegIds.length) break;
        }
      }

      if (expectedIdx < reqSegIds.length) continue; 
      sequenceValidCount++;

      // Step 4: Was it within the MAX DURATION?
      const firstEffort = validSequence[0];
      const lastEffort = validSequence[validSequence.length - 1];
      
      const startTimeMs = new Date(firstEffort.start_date).getTime();
      const endTimeMs = new Date(lastEffort.start_date).getTime() + (lastEffort.elapsed_time * 1000);
      
      const durationHours = (endTimeMs - startTimeMs) / (1000 * 3600);
      const totalElapsedSeconds = validSequence.reduce((sum, e) => sum + e.elapsed_time, 0);

      if (durationHours > durationHoursLimit) continue;
      durationValidCount++;

      // Passed all checks!
      finalLeaderboard.push({
        athlete: athName,
        total_seconds: totalElapsedSeconds,
        time_human: formatTime(totalElapsedSeconds)
      });
    }

    logStep(`  ✅ ${completedAllCount} athletes completed ALL segments.`);
    logStep(`  ✅ ${sequenceValidCount} athletes completed them in the correct SEQUENCE.`);
    logStep(`  ✅ ${durationValidCount} athletes completed them within the ${durationHoursLimit}h DURATION limit.`);

    // Step 5: Ranking
    logStep(`📊 --- STEP 5: Final Ranking ---`);
    finalLeaderboard.sort((a, b) => a.total_seconds - b.total_seconds);
    finalLeaderboard.forEach((row, idx) => row.rank = idx + 1);
    
    logStep(`  🏆 Leaderboard generated with ${finalLeaderboard.length} athletes.`);

    return res.status(200).json({
      leaderboard: finalLeaderboard,
      debug_steps: debugSteps
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
