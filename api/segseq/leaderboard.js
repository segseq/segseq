import { query } from "../../db.js";

export function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  let result = "";
  if (h > 0) result += `${h}h `;
  if (m > 0 || h > 0) result += `${m}m `;
  result += `${s}s`;
  return result.trim();
}

// === LE MOTEUR DE CALCUL ===
export async function calculateLeaderboard(challengeId, allAthletes, logStep = console.log) {
  logStep(`📊 --- STARTING LEADERBOARD CALCULATION ---`);
  
  const challengeRows = await query(`SELECT duration_hours, strict_sequence FROM challenges WHERE id = $1`, [challengeId]);
  if (challengeRows.length === 0) {
    logStep(`❌ Error: Challenge ${challengeId} not found in DB.`);
    return [];
  }
  
  const durationHoursLimit = Number(challengeRows[0].duration_hours);
  const isStrictSequence = challengeRows[0].strict_sequence !== false;
  
  logStep(`⚙️ Rules: Max Duration = ${durationHoursLimit}h | Strict Sequence = ${isStrictSequence ? 'YES' : 'NO'}`);

  const segmentsRows = await query(`SELECT segment_id FROM challenge_segments WHERE challenge_id = $1 ORDER BY order_index ASC`, [challengeId]);
  if (segmentsRows.length === 0) return [];
  
  const reqSegIds = segmentsRows.map(s => String(s.segment_id));
  const uniqueSegIds = [...new Set(reqSegIds)]; // NOUVEAU : Liste des segments uniques
  
  logStep(`📍 Required Sequence (${reqSegIds.length} steps): ${reqSegIds.join(' ➔ ')}`);

  // NOUVEAU : On calcule combien de fois chaque segment est requis
  const requiredCounts = {};
  reqSegIds.forEach(id => {
    requiredCounts[id] = (requiredCounts[id] || 0) + 1;
  });

  // MODIFICATION : On inclut effort_id et on utilise uniqueSegIds
  const efforts = await query(`SELECT effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time FROM segment_efforts WHERE segment_id = ANY($1::bigint[])`, [uniqueSegIds]);
  logStep(`📥 Retrieved ${efforts.length} raw efforts from database.`);

  const athletesMap = {};
  allAthletes.forEach(a => {
    athletesMap[a.id] = {
      name: `${a.firstname} ${a.lastname}`.trim(),
      profile: a.profile,
      sex: a.sex,
      efforts: []
    };
  });

  efforts.forEach(e => {
    if (athletesMap[e.athlete_id]) {
      athletesMap[e.athlete_id].efforts.push(e);
    }
  });

  let finalLeaderboard = [];

  for (const [athId, athData] of Object.entries(athletesMap)) {
    const athName = athData.name;
    logStep(`\n👤 Evaluating athlete: ${athName} (ID: ${athId})`);
    
    const effortsBySeg = {};
    uniqueSegIds.forEach(id => effortsBySeg[id] = []);
    athData.efforts.forEach(e => { 
      const sId = String(e.segment_id);
      if (effortsBySeg[sId]) effortsBySeg[sId].push(e); 
    });

    // NOUVEAU : Vérification stricte des quantités (Laps/Boucles)
    let hasEnoughEfforts = true;
    for (const [id, reqCount] of Object.entries(requiredCounts)) {
      const count = effortsBySeg[id].length;
      logStep(`  - Seg ${id}: ${count} effort(s) found (Needs ${reqCount})`);
      if (count < reqCount) {
        hasEnoughEfforts = false;
      }
    }
    
    if (!hasEnoughEfforts) {
      logStep(`  ❌ Failed: Missing efforts for one or more segments.`);
      continue;
    }

    let bestMovingSeconds = Infinity;
    let bestSequence = null;

    let startingEfforts = [];
    if (isStrictSequence) {
      startingEfforts = effortsBySeg[reqSegIds[0]];
    } else {
      // NOUVEAU : Utilisation de uniqueSegIds pour éviter les doublons au départ
      for (const segId of uniqueSegIds) {
        startingEfforts = startingEfforts.concat(effortsBySeg[segId]);
      }
    }

    for (const startEffort of startingEfforts) {
      const windowStartMs = new Date(startEffort.start_date).getTime();
      const windowEndMs = windowStartMs + (durationHoursLimit * 3600 * 1000);

      let possibleEffortsBySeg = {};
      let hasAllInWindow = true;
      
      for (const segId of uniqueSegIds) {
        const effortsInWindow = effortsBySeg[segId].filter(e => {
          const tStart = new Date(e.start_date).getTime();
          const tEnd = tStart + (Number(e.elapsed_time) * 1000);
          return tStart >= windowStartMs && tEnd <= windowEndMs;
        });
        
        if (effortsInWindow.length < requiredCounts[segId]) {
          hasAllInWindow = false;
          break; 
        }
        possibleEffortsBySeg[segId] = effortsInWindow;
      }

      if (!hasAllInWindow) continue;

      function search(currentSeq, usedIndices, prevEndMs, currentMovingSecs) {
        if (currentMovingSecs >= bestMovingSeconds) return; 

        if (currentSeq.length === reqSegIds.length) {
          bestMovingSeconds = currentMovingSecs;
          bestSequence = [...currentSeq];
          return;
        }

        // NOUVEAU : On garde la trace des efforts physiques déjà utilisés
        const usedEffortIds = new Set(currentSeq.map(e => e.effort_id));

        if (isStrictSequence) {
          const nextSegId = reqSegIds[currentSeq.length];
          for (const e of possibleEffortsBySeg[nextSegId]) {
            // Empêche de réutiliser la même performance
            if (usedEffortIds.has(e.effort_id)) continue; 

            const tStart = new Date(e.start_date).getTime();
            if (tStart >= prevEndMs) {
              currentSeq.push(e);
              search(currentSeq, usedIndices, tStart + Number(e.elapsed_time)*1000, currentMovingSecs + Number(e.elapsed_time));
              currentSeq.pop();
            }
          }
        } else {
          for (let i = 0; i < reqSegIds.length; i++) {
            if (usedIndices.has(i)) continue;
            const segId = reqSegIds[i];

            for (const e of possibleEffortsBySeg[segId]) {
              // Empêche de réutiliser la même performance
              if (usedEffortIds.has(e.effort_id)) continue;

              const tStart = new Date(e.start_date).getTime();
              if (tStart >= prevEndMs) {
                currentSeq.push(e);
                usedIndices.add(i);
                search(currentSeq, usedIndices, tStart + Number(e.elapsed_time)*1000, currentMovingSecs + Number(e.elapsed_time));
                usedIndices.delete(i);
                currentSeq.pop();
              }
            }
          }
        }
      }

      const startSegId = String(startEffort.segment_id);
      const startEndMs = windowStartMs + Number(startEffort.elapsed_time)*1000;
      
      let startIndex = 0;
      if (!isStrictSequence) {
        startIndex = reqSegIds.indexOf(startSegId);
      }

      const usedIdx = new Set([startIndex]);
      search([startEffort], usedIdx, startEndMs, Number(startEffort.elapsed_time));
    }

    if (bestSequence) {
      const firstE = bestSequence[0];
      const lastE = bestSequence[bestSequence.length - 1];
      const totalTimeSeconds = Math.floor((new Date(lastE.start_date).getTime() + Number(lastE.elapsed_time)*1000 - new Date(firstE.start_date).getTime()) / 1000);
      
      const bestCompletion = {
        athlete_id: athId,
        athlete: athName,
        profile: athData.profile || null,
        sex: athData.sex || null,
        moving_seconds: bestMovingSeconds,
        moving_time_human: formatTime(bestMovingSeconds),
        total_time_human: formatTime(totalTimeSeconds),
        start_date: new Date(firstE.start_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      };
      
      logStep(`  ✅ Success! Best moving time: ${bestCompletion.moving_time_human} (Total time: ${bestCompletion.total_time_human})`);
      finalLeaderboard.push(bestCompletion);
    } else {
      logStep(`  ❌ Failed: No valid sequence fits within the ${durationHoursLimit}h window.`);
    }
  }

  finalLeaderboard.sort((a, b) => a.moving_seconds - b.moving_seconds);
  finalLeaderboard.forEach((row, idx) => row.rank = idx + 1);

  logStep(`\n🏆 Leaderboard generated with ${finalLeaderboard.length} athlete(s). Updating DB...`);
  
  await query(`DELETE FROM challenge_results WHERE challenge_id = $1`, [challengeId]);
  for (const row of finalLeaderboard) {
    await query(`
      INSERT INTO challenge_results (challenge_id, athlete_id, athlete_name, rank, start_date, total_time_human, moving_time_human, moving_seconds, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [challengeId, row.athlete_id, row.athlete, row.rank, row.start_date, row.total_time_human, row.moving_time_human, row.moving_seconds]);
  }
  
  return finalLeaderboard;
}

// === L'API PRINCIPALE ===
export default async function handler(req, res) {
  const challengeId = req.query.id;
  const force = req.query.force === "1";

  if (!challengeId) return res.status(400).json({ error: "Missing challenge id" });

  try {
    let debugSteps = [];
    const logStep = (msg) => {
      console.log(msg);
      debugSteps.push(`> ${msg}`);
    };

    const allAthletes = await query(`SELECT id, firstname, lastname, profile, sex, access_token, refresh_token, expires_at FROM athletes WHERE access_token IS NOT NULL`);

    if (!force) {
      const results = await query(`
        SELECT cr.athlete_name as athlete, cr.rank, cr.start_date, cr.total_time_human, cr.moving_time_human, a.profile, a.sex 
        FROM challenge_results cr
        LEFT JOIN athletes a ON a.id = cr.athlete_id
        WHERE cr.challenge_id = $1 ORDER BY cr.rank ASC
      `, [challengeId]);
      
      return res.status(200).json({
        leaderboard: results,
        debug_steps: ["> ⚡ Loaded instantly from database cache (No API calls).", "> Click the refresh button to force Strava synchronization."]
      });
    }

    logStep("🔄 Force refresh requested. Fetching from Strava API...");
    
    // NOUVEAU : On utilise les segments uniques pour l'API Strava
    const reqSegIds = (await query(`SELECT segment_id FROM challenge_segments WHERE challenge_id = $1 ORDER BY order_index ASC`, [challengeId])).map(s => String(s.segment_id));
    const uniqueSegIds = [...new Set(reqSegIds)];
    
    let rateLimitHit = false; 
    
    for (const athlete of allAthletes) { 
      if (rateLimitHit) break; 
      const athleteName = `${athlete.firstname} ${athlete.lastname}`.trim(); 
      logStep(`\n📡 API Sync for athlete: ${athleteName}`);
      
      const nowUnix = Math.floor(Date.now() / 1000);
      if (athlete.expires_at < nowUnix) {
        logStep(`  - Token expired, refreshing...`);
        try {
          const tokenRes = await fetch("https://www.strava.com/oauth/token", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: athlete.refresh_token })
          });
          if (tokenRes.ok) {
            const newTokens = await tokenRes.json();
            await query(`UPDATE athletes SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE id = $4`, [newTokens.access_token, newTokens.refresh_token, newTokens.expires_at, athlete.id]);
            athlete.access_token = newTokens.access_token;
          } else {
            logStep(`  - Token refresh failed.`);
            continue;
          }
        } catch (err) { continue; }
      }
      
      // MODIFICATION : Boucle sur les segments UNIQUES
      for (const segId of uniqueSegIds) { 
        if (rateLimitHit) break;
        const lastEffortDb = await query(`SELECT MAX(start_date) as last_date FROM segment_efforts WHERE segment_id = $1 AND athlete_id = $2`, [segId, athlete.id]);
        
        let dateFilter = "";
        if (lastEffortDb.length > 0 && lastEffortDb[0].last_date) {
          const lastDate = new Date(lastEffortDb[0].last_date);
          lastDate.setSeconds(lastDate.getSeconds() + 1);
          const startDateStr = lastDate.toISOString().split('.')[0] + 'Z';
          const endDateStr = new Date().toISOString().split('.')[0] + 'Z';
          dateFilter = `&start_date_local=${encodeURIComponent(startDateStr)}&end_date_local=${encodeURIComponent(endDateStr)}`;
        }

        let page = 1, hasMorePages = true, totalInsertedForSegment = 0;
        
        while (hasMorePages && page <= 10) {
          const stravaUrl = `https://www.strava.com/api/v3/segment_efforts?segment_id=${segId}&per_page=200&page=${page}${dateFilter}`;
          const lbRes = await fetch(stravaUrl, { headers: { Authorization: `Bearer ${athlete.access_token}` } });
          
          if (lbRes.ok) {
            const lbData = await lbRes.json();
            if (Array.isArray(lbData) && lbData.length > 0) {
              for (const entry of lbData) {
                const resDb = await query(`
                  INSERT INTO segment_efforts (effort_id, segment_id, athlete_id, athlete_name, start_date, elapsed_time) 
                  VALUES ($1, $2, $3, $4, $5, $6) 
                  ON CONFLICT (effort_id) DO NOTHING RETURNING id;
                `, [entry.id, segId, athlete.id, athleteName, entry.start_date_local, entry.elapsed_time]);
                
                if (resDb.length > 0) totalInsertedForSegment++;
              }
              if (lbData.length === 200) page++; else hasMorePages = false;
            } else hasMorePages = false;
          } else if (lbRes.status === 429) {
            logStep(`🛑 ALERT: Strava Rate Limit Exceeded.`);
            hasMorePages = false; rateLimitHit = true; 
          } else { 
            hasMorePages = false; 
          }
        }
        logStep(`  - Seg ${segId}: ${totalInsertedForSegment} NEW efforts saved.`);
      }
    }

    const finalLeaderboard = await calculateLeaderboard(challengeId, allAthletes, logStep);

    return res.status(200).json({ leaderboard: finalLeaderboard, debug_steps: debugSteps });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
