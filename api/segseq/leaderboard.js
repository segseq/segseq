import { query } from "../../db.js";


function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}


export default async function handler(req, res) {
  const challengeId = req.query.id;
  const force = req.query.force === "1";


  if (!challengeId) return res.status(400).json({ error: "Missing challenge id" });


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
      logStep("🔄 Force refresh requested. Fetching efforts for ALL registered athletes...");
      
      // Get all athletes who have an access token
      const allAthletes = await query(`
        SELECT id, firstname, lastname, access_token 
        FROM athletes 
        WHERE access_token IS NOT NULL
      `);
      
      logStep(`Found ${allAthletes.length} registered athletes to check.`);


      for (const athlete of allAthletes) {
        const athleteName = `${athlete.firstname} ${athlete.lastname}`.trim();
        logStep(`Checking efforts for ${athleteName}...`);
        
        for (const segId of reqSegIds) {
          // Fetch using THIS specific athlete's token
          const lbRes = await fetch(`https://www.strava.com/api/v3/segments/${segId}/all_efforts`, {
            headers: { Authorization: `Bearer ${athlete.access_token}` }
          });
          
          if (lbRes.ok) {
            const lbData = await lbRes.json();
            
            if (Array.isArray(lbData) && lbData.length > 0) {
              let inserted = 0;
              for (const entry of lbData) {
                const resDb = await query(`
                  INSERT INTO segment_efforts (segment_id, athlete_name, start_date, elapsed_time)
                  VALUES ($1, $2, $3, $4)
                  ON CONFLICT (segment_id, athlete_name, start_date) DO NOTHING
                  RETURNING id;
                `, [segId, athleteName, entry.start_date_local, entry.elapsed_time]);
                
                if (resDb.length > 0) inserted++;
              }
              if (inserted > 0) {
                logStep(`  - Segment ${segId}: Saved ${inserted} new efforts for ${athleteName}.`);
              }
            }
          } else if (lbRes.status === 401) {
            logStep(`  - ⚠️ Token expired for ${athleteName}. (Needs OAuth refresh implementation)`);
          } else {
            logStep(`  - ⚠️ API Error ${lbRes.status} for ${athleteName} on segment ${segId}.`);
          }
        }
      }
    } else {
      logStep("⚡ Loading data from local Database (No Strava API calls used).");
    }


    // ==========================================
    // PHASE 2: EVALUATE LOGIC STEP-BY-STEP
    // ==========================================
    
    const efforts = await query(
      `SELECT segment_id, athlete_name, start_date, elapsed_time 
       FROM segment_efforts WHERE segment_id = ANY($1::bigint[])`,
      [reqSegIds]
    );


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
      logStep(`  - Segment ${idx + 1} (${id}): ${segmentCounts[id].size} athletes found in DB`);
    });


    let completedAllCount = 0;
    let sequenceValidCount = 0;
    let durationValidCount = 0;
    let finalLeaderboard = [];


    logStep(`📊 --- STEP 2 to 4: Evaluating ${Object.keys(athletes).length} Total Athletes ---`);


    for (const [athName, athEfforts] of Object.entries(athletes)) {
      const uniqueSegs = new Set(athEfforts.map(e => e.segment_id));
      if (uniqueSegs.size < reqSegIds.length) continue; 
      completedAllCount++;


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


      const firstEffort = validSequence[0];
      const lastEffort = validSequence[validSequence.length - 1];
      
      const startTimeMs = new Date(firstEffort.start_date).getTime();
      const endTimeMs = new Date(lastEffort.start_date).getTime() + (lastEffort.elapsed_time * 1000);
      
      const durationHours = (endTimeMs - startTimeMs) / (1000 * 3600);
      const totalElapsedSeconds = validSequence.reduce((sum, e) => sum + e.elapsed_time, 0);


      if (durationHours > durationHoursLimit) continue;
      durationValidCount++;


      finalLeaderboard.push({
        athlete: athName,
        total_seconds: totalElapsedSeconds,
        time_human: formatTime(totalElapsedSeconds)
      });
    }


    logStep(`  ✅ ${completedAllCount} athletes completed ALL segments.`);
    logStep(`  ✅ ${sequenceValidCount} athletes completed them in the correct SEQUENCE.`);
    logStep(`  ✅ ${durationValidCount} athletes completed them within the ${durationHoursLimit}h limit.`);


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
