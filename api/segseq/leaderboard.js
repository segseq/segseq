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
    // PHASE 2: EVALUATE LOGIC (NO SEQUENCE REQUIRED)
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
    let durationValidCount = 0;
    let finalLeaderboard = [];

    logStep(`📊 --- STEP 2 & 3: Evaluating ${Object.keys(athletes).length} Total Athletes ---`);

    for (const [athName, athEfforts] of Object.entries(athletes)) {
      
      // Step 2: Did they complete ALL segments at least once overall?
      const uniqueSegs = new Set(athEfforts.map(e => e.segment_id));
      if (uniqueSegs.size < reqSegIds.length) continue; 
      completedAllCount++;

      let bestCompletion = null;

      // Step 3: Sliding Time Window Check
      // Treat every effort as a potential "Start" of the challenge window
      for (const startEffort of athEfforts) {
        const windowStartMs = new Date(startEffort.start_date).getTime();
        const windowMaxEndMs = windowStartMs + (durationHoursLimit * 3600 * 1000);

        // Filter all efforts for this athlete that fall entirely within this time window
        const effortsInWindow = athEfforts.filter(e => {
          const eStart = new Date(e.start_date).getTime();
          const eEnd = eStart + (e.elapsed_time * 1000);
          return eStart >= windowStartMs && eEnd <= windowMaxEndMs;
        });

        // Group the efforts inside this window by segment
        const segMap = {};
        effortsInWindow.forEach(e => {
          if (!segMap[e.segment_id]) segMap[e.segment_id] = [];
          segMap[e.segment_id].push(e);
        });

        // Does this window contain at least one effort for EVERY required segment?
        if (Object.keys(segMap).length === reqSegIds.length) {
          
          let totalElapsedSeconds = 0;
          let actualStartMs = Infinity;
          let actualEndMs = 0;

          // Find the FASTEST effort for each segment within this specific window
          for (const segId of reqSegIds) {
            segMap[segId].sort((a, b) => a.elapsed_time - b.elapsed_time);
            const fastest = segMap[segId][0];
            
            totalElapsedSeconds += fastest.elapsed_time;
            
            const fStart = new Date(fastest.start_date).getTime();
            const fEnd = fStart + (fastest.elapsed_time * 1000);
            if (fStart < actualStartMs) actualStartMs = fStart;
            if (fEnd > actualEndMs) actualEndMs = fEnd;
          }

          const actualDurationHours = (actualEndMs - actualStartMs) / (1000 * 3600);

          // Save it if it's their best overall time
          if (!bestCompletion || totalElapsedSeconds < bestCompletion.total_seconds) {
            bestCompletion = {
              athlete: athName,
              total_seconds: totalElapsedSeconds,
              time_human: formatTime(totalElapsedSeconds),
              debug_duration: actualDurationHours.toFixed(2)
            };
          }
        }
      }

      if (bestCompletion) {
        durationValidCount++;
        logStep(`  - ✅ ${athName} passed! Duration window: ${bestCompletion.debug_duration}h, Moving Time: ${bestCompletion.time_human}`);
        finalLeaderboard.push(bestCompletion);
      } else {
        logStep(`  - ❌ ${athName} failed: Completed all segments, but never within a ${durationHoursLimit}h window.`);
      }
    }

    logStep(`  ✅ ${completedAllCount} athletes completed ALL segments.`);
    logStep(`  ✅ ${durationValidCount} athletes completed them within a ${durationHoursLimit}h window (Any Order).`);

    logStep(`📊 --- STEP 4: Final Ranking ---`);
    finalLeaderboard.sort((a, b) => a.total_seconds - b.total_seconds);
    finalLeaderboard.forEach((row, idx) => row.rank = idx + 1);
    
    logStep(`  🏆 Leaderboard generated with ${finalLeaderboard.length} athletes.`);

    // ==========================================
    // PHASE 3: SAVE RESULTS TO DATABASE
    // ==========================================
    logStep(`💾 --- STEP 5: Saving to Database ---`);
    
    await query(`DELETE FROM challenge_results WHERE challenge_id = $1`, [challengeId]);

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