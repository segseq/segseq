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
export async function calculateLeaderboard(challengeId, logStep = console.log) {
  logStep(`📊 --- DÉBUT DU CALCUL DU CLASSEMENT ---`);
  
  const challengeRows = await query(`SELECT duration_hours, strict_sequence FROM challenges WHERE id = $1`, [challengeId]);
  if (challengeRows.length === 0) {
    logStep(`❌ Erreur : Challenge ${challengeId} introuvable en base.`);
    return [];
  }
  
  const durationHoursLimit = challengeRows[0].duration_hours;
  const isStrictSequence = challengeRows[0].strict_sequence !== false;
  
  logStep(`⚙️ Règles : Limite de ${durationHoursLimit}h | Séquence stricte : ${isStrictSequence ? 'OUI' : 'NON'}`);

  const segmentsRows = await query(`SELECT segment_id FROM challenge_segments WHERE challenge_id = $1 ORDER BY order_index ASC`, [challengeId]);
  if (segmentsRows.length === 0) {
    logStep(`❌ Erreur : Aucun segment défini pour ce challenge.`);
    return [];
  }
  
  const reqSegIds = segmentsRows.map(s => s.segment_id);
  logStep(`📍 Segments requis (${reqSegIds.length}) : ${reqSegIds.join(' ➔ ')}`);

  const efforts = await query(`SELECT segment_id, athlete_name, start_date, elapsed_time FROM segment_efforts WHERE segment_id = ANY($1::bigint[])`, [reqSegIds]);
  logStep(`📥 ${efforts.length} efforts bruts récupérés en base pour ces segments.`);

  const athletes = {};
  efforts.forEach(e => {
    if (!athletes[e.athlete_name]) athletes[e.athlete_name] = [];
    athletes[e.athlete_name].push(e);
  });

  let finalLeaderboard = [];

  for (const [athName, athEfforts] of Object.entries(athletes)) {
    logStep(`\n👤 Évaluation de l'athlète : ${athName}`);
    
    const effortsBySeg = {};
    reqSegIds.forEach(id => effortsBySeg[id] = []);
    athEfforts.forEach(e => { if (effortsBySeg[e.segment_id]) effortsBySeg[e.segment_id].push(e); });

    const requiredCounts = {};
    reqSegIds.forEach(id => { requiredCounts[id] = (requiredCounts[id] || 0) + 1; });

    let hasEnoughEfforts = true;
    for (const id in requiredCounts) {
      const count = effortsBySeg[id].length;
      logStep(`  - Seg ${id} : ${count} effort(s) trouvé(s)`);
      if (count < requiredCounts[id]) {
        hasEnoughEfforts = false; 
      }
    }
    
    if (!hasEnoughEfforts) {
      logStep(`  ❌ Échec : Il manque des efforts sur un ou plusieurs segments.`);
      continue;
    }

    for (const id in effortsBySeg) {
      effortsBySeg[id].sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
    }

    let validSequences = [];
    
    function findSequences(currentSeq, usedIndices) {
      if (usedIndices.length === reqSegIds.length) {
        validSequences.push([...currentSeq]);
        return;
      }
      
      const firstEffort = currentSeq[0];
      const lastEffort = currentSeq[currentSeq.length - 1];
      
      const currentStartTimeMs = new Date(firstEffort.start_date).getTime();
      const prevEndTimeMs = new Date(lastEffort.start_date).getTime() + (Number(lastEffort.elapsed_time) * 1000);
      
      // OPTIMISATION MAJEURE : On calcule la date limite absolue pour cette séquence
      const maxEndTimeMs = currentStartTimeMs + (durationHoursLimit * 3600 * 1000);
      
      if (isStrictSequence) {
        const nextIndex = usedIndices.length;
        const nextSegId = reqSegIds[nextIndex];
        
        // On ne garde que les efforts qui commencent APRÈS le segment précédent, mais AVANT la limite de temps du challenge
        const possibleNextEfforts = effortsBySeg[nextSegId].filter(e => {
          const eStart = new Date(e.start_date).getTime();
          return eStart >= prevEndTimeMs && eStart <= maxEndTimeMs;
        });
        
        for (const nextEffort of possibleNextEfforts) {
          currentSeq.push(nextEffort);
          usedIndices.push(nextIndex);
          findSequences(currentSeq, usedIndices);
          usedIndices.pop();
          currentSeq.pop();
        }
      } else {
        for (let i = 0; i < reqSegIds.length; i++) {
          if (usedIndices.includes(i)) continue; 
          
          const nextSegId = reqSegIds[i];
          const possibleNextEfforts = effortsBySeg[nextSegId].filter(e => {
            const eStart = new Date(e.start_date).getTime();
            return eStart >= prevEndTimeMs && eStart <= maxEndTimeMs;
          });
          
          for (const nextEffort of possibleNextEfforts) {
            currentSeq.push(nextEffort);
            usedIndices.push(i);
            findSequences(currentSeq, usedIndices);
            usedIndices.pop();
            currentSeq.pop();
          }
        }
      }
    }

    if (isStrictSequence) {
      const firstSegId = reqSegIds[0];
      for (const startEffort of effortsBySeg[firstSegId]) {
        findSequences([startEffort], [0]); 
      }
    } else {
      for (let i = 0; i < reqSegIds.length; i++) {
        const firstSegId = reqSegIds[i];
        for (const startEffort of effortsBySeg[firstSegId]) {
          findSequences([startEffort], [i]);
        }
      }
    }

    logStep(`  🔍 Séquences valides dans le temps imparti : ${validSequences.length}`);

    let bestCompletion = null;
    for (const seq of validSequences) {
      const startEffort = seq[0];
      const endEffort = seq[seq.length - 1];
      const startTimeMs = new Date(startEffort.start_date).getTime();
      const endTimeMs = new Date(endEffort.start_date).getTime() + (Number(endEffort.elapsed_time) * 1000);
      const totalTimeSeconds = Math.floor((endTimeMs - startTimeMs) / 1000);

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

    if (bestCompletion) {
      logStep(`  ✅ Succès ! Meilleur temps de mouvement : ${bestCompletion.moving_time_human}`);
      finalLeaderboard.push(bestCompletion);
    } else {
      logStep(`  ❌ Échec : Aucune combinaison ne respecte la limite de ${durationHoursLimit}h.`);
    }
  }

  finalLeaderboard.sort((a, b) => a.moving_seconds - b.moving_seconds);
  finalLeaderboard.forEach((row, idx) => row.rank = idx + 1);

  logStep(`\n🏆 Classement généré avec ${finalLeaderboard.length} athlète(s). Mise à jour de la DB...`);
  
  await query(`DELETE FROM challenge_results WHERE challenge_id = $1`, [challengeId]);
  for (const row of finalLeaderboard) {
    await query(`
      INSERT INTO challenge_results (challenge_id, athlete_name, rank, start_date, total_time_human, moving_time_human, moving_seconds, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [challengeId, row.athlete, row.rank, row.start_date, row.total_time_human, row.moving_time_human, row.moving_seconds]);
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
      console.log(msg); // Log serveur
      debugSteps.push(`> ${msg}`); // Log renvoyé au client HTML
    };

    if (!force) {
      const results = await query(`
        SELECT athlete_name as athlete, rank, start_date, total_time_human, moving_time_human 
        FROM challenge_results WHERE challenge_id = $1 ORDER BY rank ASC
      `, [challengeId]);
      
      return res.status(200).json({
        leaderboard: results,
        debug_steps: ["> ⚡ Chargement instantané depuis le cache de la base de données (Pas d'appel API).", "> Cliquez sur le bouton de rafraîchissement pour forcer la synchronisation avec Strava."]
      });
    }

    logStep("🔄 Rafraîchissement forcé demandé. Interrogation de l'API Strava...");
    const reqSegIds = (await query(`SELECT segment_id FROM challenge_segments WHERE challenge_id = $1`, [challengeId])).map(s => s.segment_id);
    const allAthletes = await query(`SELECT id, firstname, lastname, access_token, refresh_token, expires_at FROM athletes WHERE access_token IS NOT NULL`); 
    
    let rateLimitHit = false; 
    
    for (const athlete of allAthletes) { 
      if (rateLimitHit) break; 
      const athleteName = `${athlete.firstname} ${athlete.lastname}`.trim(); 
      logStep(`\n📡 Sync API pour l'athlète : ${athleteName}`);
      
      const nowUnix = Math.floor(Date.now() / 1000);
      if (athlete.expires_at < nowUnix) {
        logStep(`  - Token expiré, rafraîchissement en cours...`);
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
            logStep(`  - Échec du rafraîchissement du token.`);
            continue;
          }
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
            logStep(`🛑 ALERTE : Limite de requêtes Strava atteinte (Rate Limit).`);
            hasMorePages = false; rateLimitHit = true; 
          } else { 
            hasMorePages = false; 
          }
        }
        logStep(`  - Seg ${segId} : ${totalInsertedForSegment} NOUVEAUX efforts sauvegardés.`);
      }
    }

    const finalLeaderboard = await calculateLeaderboard(challengeId, logStep);

    return res.status(200).json({ leaderboard: finalLeaderboard, debug_steps: debugSteps });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}