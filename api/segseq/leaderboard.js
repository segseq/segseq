import { query } from "../../db.js";


function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  
  let result = "";
  if (h > 0) result += `${h}h `;
  if (m > 0 || h > 0) result += `${m}m `; // Show minutes if hours exist, even if minutes are 0
  result += `${s}s`;
  
  return result.trim();
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
    // PHASE 1: SYNC STRAVA DATA TO LOCAL DB (OPTIMIZED)
    // ==========================================
    if (force) {
      logStep("🔄 Force refresh requested. Fetching NEW efforts for registered athletes...");
      
      const allAthletes = await query(`
        SELECT id, firstname, lastname, access_token 
        FROM athletes 
        WHERE access_token IS NOT NULL
      `);
      
      let rateLimitHit = false;

      for (const athlete of allAthletes) {
        if (rateLimitHit) break;

        const athleteName = `${athlete.firstname} ${athlete.lastname}`.trim();
        logStep(`Checking efforts for ${athleteName}...`);
        
        for (const segId of reqSegIds) {
          if (rateLimitHit) break;
          
          // --- OPTIMIZATION: Find the newest effort we already have ---
          const lastEffortDb = await query(`
            SELECT MAX(start_date) as last_date 
            FROM segment_efforts 
            WHERE segment_id = $1 AND athlete_name = $2
          `, [segId, athleteName]);

          let dateFilter = "";
          if (lastEffortDb.length > 0 && lastEffortDb[0].last_date) {
            // Add 1 second to the last known effort so we don't fetch it again
            const lastDate = new Date(lastEffortDb[0].last_date);
            lastDate.setSeconds(lastDate.getSeconds() + 1);
            dateFilter = `&start_date_local=${lastDate.toISOString()}`;
            logStep(`  - Incremental sync: Only fetching efforts after ${lastDate.toLocaleDateString()}`);
          } else {
            logStep(`  - First time sync: Fetching full history...`);
          }
          // -----------------------------------------------------------

          let page = 1;
          let hasMorePages = true;
          let totalInsertedForSegment = 0;
          const MAX_PAGES = 3; 

          while (hasMorePages && page <= MAX_PAGES) {
            // Append the dateFilter to the Strava URL
            const stravaUrl = `https://www.strava.com/api/v3/segments/${segId}/all_efforts?per_page=200&page=${page}${dateFilter}`;
            
            const lbRes = await fetch(stravaUrl, {
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
                
                totalInsertedForSegment += inserted;

                if (lbData.length === 200) {
                  page++;
                } else {
                  hasMorePages = false;
                }
              } else {
                hasMorePages = false; // No new efforts found
              }
            } else if (lbRes.status === 429) {
              logStep(`  - 🛑 STRAVA RATE LIMIT EXCEEDED (429). Stop clicking sync! Please wait 15 minutes.`);
              hasMorePages = false;
              rateLimitHit = true; 
            } else if (lbRes.status === 401) {
              logStep(`  - ⚠️ Token expired for ${athleteName}.`);
              hasMorePages = false;
            } else {
              logStep(`  - ⚠️ API Error ${lbRes.status} for ${athleteName} on segment ${segId}.`);
              hasMorePages = false;
            }
          }

          if (totalInsertedForSegment > 0) {
            logStep(`  - Segment ${segId}: Saved ${totalInsertedForSegment} NEW efforts.`);
          } else if (!rateLimitHit) {
            logStep(`  - Segment ${segId}: Up to date (0 new efforts).`);
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
      
      // Step 2: Did they complete ALL segments at least once?
      const uniqueSegs = new Set(athEfforts.map(e => e.segment_id));
      if (uniqueSegs.size < reqSegIds.length) continue; 
      completedAllCount++;

      // Group their efforts by segment and sort chronologically
      const effortsBySeg = {};
      reqSegIds.forEach(id => effortsBySeg[id] = []);
      athEfforts.forEach(e => effortsBySeg[e.segment_id].push(e));
      
      for (const id in effortsBySeg) {
        effortsBySeg[id].sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
      }

      let hasValidSequence = false;
      let bestCompletion = null;

      // Step 3: Try to build a valid sequence starting from EACH effort of the first segment
      const firstSegId = reqSegIds[0];
      
      for (const startEffort of effortsBySeg[firstSegId]) {
        let currentSequence = [startEffort];
        // End time of the current segment effort
        let prevEndTimeMs = new Date(startEffort.start_date).getTime() + (startEffort.elapsed_time * 1000);
        let seqOk = true;

        // Look for the next segments in order
        for (let i = 1; i < reqSegIds.length; i++) {
          const nextSegId = reqSegIds[i];
          // Find the FIRST effort on the next segment that started AFTER the previous segment ended
          const nextEffort = effortsBySeg[nextSegId].find(e => new Date(e.start_date).getTime() >= prevEndTimeMs);
          
          if (nextEffort) {
            currentSequence.push(nextEffort);
            prevEndTimeMs = new Date(nextEffort.start_date).getTime() + (nextEffort.elapsed_time * 1000);
          } else {
            seqOk = false; // Sequence broken
            break;
          }
        }

        if (seqOk) {
          hasValidSequence = true;
          
          // Step 4: Sequence is valid! Now check the duration limit.
          // Duration = (End time of last segment) - (Start time of first segment)
          const startTimeMs = new Date(startEffort.start_date).getTime();
          const durationHours = (prevEndTimeMs - startTimeMs) / (1000 * 3600);

          if (durationHours <= durationHoursLimit) {
            // Calculate sum of actual moving/elapsed time for the leaderboard ranking
            const totalElapsedSeconds = currentSequence.reduce((sum, e) => sum + e.elapsed_time, 0);
            
            // If they did the challenge multiple times, keep their fastest total time
            if (!bestCompletion || totalElapsedSeconds < bestCompletion.total_seconds) {
              bestCompletion = {
                athlete: athName,
                total_seconds: totalElapsedSeconds,
                time_human: formatTime(totalElapsedSeconds),
                debug_duration: durationHours.toFixed(2)
              };
            }
          } else {
             logStep(`  - ❌ ${athName} failed duration: Took ${durationHours.toFixed(2)}h (Limit: ${durationHoursLimit}h)`);
          }
        }
      }

      if (hasValidSequence) sequenceValidCount++;
      
      if (bestCompletion) {
        durationValidCount++;
        logStep(`  - ✅ ${athName} passed! Duration: ${bestCompletion.debug_duration}h, Moving Time: ${bestCompletion.time_human}`);
        finalLeaderboard.push(bestCompletion);
      }
    }

    logStep(`  ✅ ${completedAllCount} athletes completed ALL segments.`);
    logStep(`  ✅ ${sequenceValidCount} athletes completed them in the correct SEQUENCE.`);
    logStep(`  ✅ ${durationValidCount} athletes completed them within the ${durationHoursLimit}h limit.`);

    logStep(`📊 --- STEP 5: Final Ranking ---`);
    finalLeaderboard.sort((a, b) => a.total_seconds - b.total_seconds);
    finalLeaderboard.forEach((row, idx) => row.rank = idx + 1);
    
    logStep(`  🏆 Leaderboard generated with ${finalLeaderboard.length} athletes.`);

    // ==========================================
    // PHASE 3: SAVE RESULTS TO DATABASE
    // ==========================================
    logStep(`💾 --- STEP 6: Saving to Database ---`);
    
    // 1. Clear old results for this challenge (in case someone's sequence became invalid)
    await query(`DELETE FROM challenge_results WHERE challenge_id = $1`, [challengeId]);

    // 2. Insert the fresh leaderboard
    let savedCount = 0;
    for (const row of finalLeaderboard) {
      await query(`
        INSERT INTO challenge_results (challenge_id, athlete_name, rank, total_seconds, time_human, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [challengeId, row.athlete, row.rank, row.total_seconds, row.time_human]);
      savedCount++;
    }
    
    logStep(`  ✅ Saved ${savedCount} rows to challenge_results table.`);

    return res.status(200).json({
      leaderboard: finalLeaderboard,
      debug_steps: debugSteps
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}