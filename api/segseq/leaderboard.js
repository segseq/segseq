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

// === LE MOTEUR DE CALCUL (Exporté pour être utilisé par le Webhook) ===
export async function calculateLeaderboard(challengeId, logStep = console.log) {
  logStep(`📊 --- ÉVALUATION DU CLASSEMENT ---`);
  
  const challengeRows = await query(`SELECT duration_hours FROM challenges WHERE id = $1`, [challengeId]);
  if (challengeRows.length === 0) return [];
  const durationHoursLimit = challengeRows[0].duration_hours;

  const segmentsRows = await query(`SELECT segment_id FROM challenge_segments WHERE challenge_id = $1 ORDER BY order_index ASC`, [challengeId]);
  if (segmentsRows.length === 0) return [];
  const reqSegIds = segmentsRows.map(s => s.segment_id);

  const efforts = await query(`SELECT segment_id, athlete_name, start_date, elapsed_time FROM segment_efforts WHERE segment_id = ANY($1::bigint[])`, [reqSegIds]);

  const athletes = {};
  efforts.forEach(e => {
    if (!athletes[e.athlete_name]) athletes[e.athlete_name] = [];
    athletes[e.athlete_name].push(e);
  });

  let finalLeaderboard = [];

  for (const [athName, athEfforts] of Object.entries(athletes)) {
    const effortsBySeg = {};
    reqSegIds.forEach(id => effortsBySeg[id] = []);
    athEfforts.forEach(e => { if (effortsBySeg[e.segment_id]) effortsBySeg[e.segment_id].push(e); });

    const requiredCounts = {};
    reqSegIds.forEach(id => { requiredCounts[id] = (requiredCounts[id] || 0) + 1; });

    let hasEnoughEfforts = true;
    for (const id in requiredCounts) {
      if (effortsBySeg[id].length < requiredCounts[id]) {
        hasEnoughEfforts = false; break;
      }
    }
    if (!hasEnoughEfforts) continue;

    for (const id in effortsBySeg) {
      effortsBySeg[id].sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
    }

    let validSequences = [];
    function findSequences(currentSeq, currentSegIndex) {
      if (currentSegIndex === reqSegIds.length) {
        validSequences.push([...currentSeq]);
        return;
      }
      const lastEffort = currentSeq[currentSeq.length - 1];
      const prevEndTimeMs = new Date(lastEffort.start_date).getTime() + (Number(lastEffort.elapsed_time) * 1000);
      const nextSegId = reqSegIds[currentSegIndex];
      const possibleNextEfforts = effortsBySeg[nextSegId].filter(e => new Date(e.start_date).getTime() >= prevEndTimeMs);
      
      for (const nextEffort of possibleNextEfforts) {
        currentSeq.push(nextEffort);
        findSequences(currentSeq, currentSegIndex + 1);
        currentSeq.pop();
      }
    }

    const firstSegId = reqSegIds[0];
    for (const startEffort of effortsBySeg[firstSegId]) {
      findSequences([startEffort], 1);
    }

    let bestCompletion = null;
    for (const seq of validSequences) {
      const startEffort = seq[0];
      const endEffort = seq[seq.length - 1];
      const startTimeMs = new Date(startEffort.start_date).getTime();
      const endTimeMs = new Date(endEffort.start_date).getTime() + (Number(endEffort.elapsed_time) * 1000);
      const totalTimeSeconds = Math.floor((endTimeMs - startTimeMs) / 1000);
      const durationHours = totalTimeSeconds / 3600;

      if (durationHours <= Number(durationHoursLimit)) {
        const movingSeconds = seq.reduce((sum, e) => sum + Number(e.elapsed_time), 0);
        if (!bestCompletion || movingSeconds < bestCompletion.moving_seconds) {
          bestCompletion = {
            athlete: athName,
            moving_seconds: movingSeconds,
            moving_time_human: formatTime(movingSeconds),
            total_time_human: formatTime(totalTimeSeconds),
            start_date: new Date(startTimeMs).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
          };
        }
      }
    }

    if (bestCompletion) {
      logStep(`  - ✅ ${athName} passed! Moving Time: ${bestCompletion.moving_time_human}`);
      finalLeaderboard.push(bestCompletion);
    }
  }

  finalLeaderboard.sort((a, b) => a.moving_seconds - b.moving_seconds);
  finalLeaderboard.forEach((row, idx) => row.rank = idx + 1);

  await query(`DELETE FROM challenge_results WHERE challenge_id = $1`, [challengeId]);
  for (const row of finalLeaderboard) {
    await query(`
      INSERT INTO challenge_results (challenge_id, athlete_name, rank, start_date, total_time_human, moving_time_human, moving_seconds, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [challengeId, row.athlete, row.rank, row.start_date, row.total_time_human, row.moving_time_human, row.moving_seconds]);
  }
  logStep(`💾 --- Sauvegarde terminée (${finalLeaderboard.length} athlètes) ---`);
  return finalLeaderboard;
}

// === L'API PRINCIPALE (Appelée par la page web) ===
export default async function handler(req, res) {
  const challengeId = req.query.id;
  const force = req.query.force === "1";

  if (!challengeId) return res.status(400).json({ error: "Missing challenge id" });

  try {
    let debugSteps = [];
    const logStep = (msg) => debugSteps.push(`> ${msg}`);

    // SI LECTURE NORMALE : On lit juste la base de données (Ultra rapide)
    if (!force) {
      const results = await query(`
        SELECT athlete_name as athlete, rank, start_date, total_time_human, moving_time_human 
        FROM challenge_results WHERE challenge_id = $1 ORDER BY rank ASC
      `, [challengeId]);
      
      return res.status(200).json({
        leaderboard: results,
        debug_steps: ["> ⚡ Loaded instantly from database cache (No API calls)."]
      });
    }

    // SI FORCE SYNC : Phase 1 (Strava) + Appel du Moteur de calcul
    logStep("🔄 Force refresh requested. Fetching NEW efforts...");
    const reqSegIds = (await query(`SELECT segment_id FROM challenge_segments WHERE challenge_id = $1`, [challengeId])).map(s => s.segment_id);
    const allAthletes = await query(`SELECT id, firstname, lastname, access_token, refresh_token, expires_at FROM athletes WHERE access_token IS NOT NULL`); 
    
    let rateLimitHit = false; 
    for (const athlete of allAthletes) { 
      if (rateLimitHit) break; 
      const athleteName = `${athlete.firstname} ${athlete.lastname}`.trim(); 
      
      // Refresh token logic
      const nowUnix = Math.floor(Date.now() / 1000);
      if (athlete.expires_at < nowUnix) {
        try {
          const tokenRes = await fetch("https://www.strava.com/oauth/token", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: athlete.refresh_token })
          });
          if (tokenRes.ok) {
            const newTokens = await tokenRes.json();
            await query(`UPDATE athletes SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE id = $4`, [newTokens.access_token, newTokens.refresh_token, newTokens.expires_at, athlete.id]);
            athlete.access_token = newTokens.access_token;
          } else continue;
        } catch (err) { continue; }
      }
      
      for (const segId of reqSegIds) { 
        if (rateLimitHit) break;
        const lastEffortDb = await query(`SELECT MAX(start_date) as last_date FROM segment_efforts WHERE segment_id = $1 AND athlete_name = $2`, [segId, athleteName]);
        let dateFilter = "";
        if (lastEffortDb.length > 0 && lastEffortDb[0].last_date) {
          const lastDate = new Date(lastEffortDb[0].last_date);
          lastDate.setSeconds(lastDate.getSeconds() + 1);
          const startDateStr = lastDate.toISOString().split('.')[0] + 'Z';
          const endDateStr = new Date().toISOString().split('.')[0] + 'Z';
          dateFilter = `&start_date_local=${encodeURIComponent(startDateStr)}&end_date_local=${encodeURIComponent(endDateStr)}`;
        }

        let page = 1, hasMorePages = true, totalInsertedForSegment = 0;
        while (hasMorePages && page <= 3) {
          const stravaUrl = `https://www.strava.com/api/v3/segments/${segId}/all_efforts?per_page=200&page=${page}${dateFilter}`;
          const lbRes = await fetch(stravaUrl, { headers: { Authorization: `Bearer ${athlete.access_token}` } });
          
          if (lbRes.ok) {
            const lbData = await lbRes.json();
            if (Array.isArray(lbData) && lbData.length > 0) {
              for (const entry of lbData) {
                const resDb = await query(`INSERT INTO segment_efforts (segment_id, athlete_name, start_date, elapsed_time) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id;`, [segId, athleteName, entry.start_date_local, entry.elapsed_time]);
                if (resDb.length > 0) totalInsertedForSegment++;
              }
              if (lbData.length === 200) page++; else hasMorePages = false;
            } else hasMorePages = false;
          } else if (lbRes.status === 429) {
            logStep(`🛑 STRAVA RATE LIMIT EXCEEDED.`);
            hasMorePages = false; rateLimitHit = true; 
          } else { hasMorePages = false; }
        }
        if (totalInsertedForSegment > 0) logStep(`  - Seg ${segId}: Saved ${totalInsertedForSegment} NEW efforts.`);
      }
    }

    // Appel de la fonction de calcul partagée
    const finalLeaderboard = await calculateLeaderboard(challengeId, logStep);

    return res.status(200).json({ leaderboard: finalLeaderboard, debug_steps: debugSteps });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}