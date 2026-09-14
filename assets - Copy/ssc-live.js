/**
 * ssc-live.js — The Sports Companion Live Data Module
 * Uses ESPN's undocumented public endpoints (no API key required)
 * Covers: NFL · MLB · NBA · NCAA · MLS · EPL · La Liga · UCL
 *
 * Public API:
 *   SSCLive.init(sport, league)        — boot polling for a league index page
 *   SSCLive.initGameday(sport, league, eventId) — boot for a specific game
 *   SSCLive.on(event, callback)        — event listener
 *   SSCLive.getScoreboard(sport, league)        — one-shot fetch
 *   SSCLive.getGameSummary(sport, league, id)   — one-shot fetch
 *
 * Events: 'scores', 'scoreboard', 'boxscore', 'plays', 'error'
 */

(function (global) {
  'use strict';

  // ── ESPN ENDPOINT MAP ──────────────────────────────────────────
  const ESPN_BASE   = 'https://site.api.espn.com/apis/site/v2/sports';
  const ESPN_WEB    = 'https://site.web.api.espn.com/apis/site/v2/sports';

  const LEAGUE_MAP = {
    nfl:    { sport: 'football',    league: 'nfl' },
    mlb:    { sport: 'baseball',    league: 'mlb' },
    nba:    { sport: 'basketball',  league: 'nba' },
    nhl:    { sport: 'hockey',      league: 'nhl' },
    ncaaf:  { sport: 'football',    league: 'college-football' },
    ncaab:  { sport: 'basketball',  league: 'mens-college-basketball' },
    ncaabw: { sport: 'basketball',  league: 'womens-college-basketball' },
    mls:    { sport: 'soccer',      league: 'usa.1' },
    epl:    { sport: 'soccer',      league: 'eng.1' },
    laliga: { sport: 'soccer',      league: 'esp.1' },
    ucl:    { sport: 'soccer',      league: 'uefa.champions' },
    bundesliga: { sport: 'soccer',  league: 'ger.1' },
    seriea: { sport: 'soccer',      league: 'ita.1' },
  };

  // ── CACHE ─────────────────────────────────────────────────────
  const cache = {};
  const CACHE_TTL = { scoreboard: 30000, summary: 15000, standings: 300000 };

  function cacheGet(key) {
    const hit = cache[key];
    if (!hit) return null;
    if (Date.now() - hit.ts > (CACHE_TTL[hit.type] || 30000)) return null;
    return hit.data;
  }
  function cacheSet(key, data, type) {
    cache[key] = { data, ts: Date.now(), type };
  }

  // ── FETCH WRAPPER ─────────────────────────────────────────────
  async function espnFetch(url, cacheKey, cacheType) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cacheSet(cacheKey, data, cacheType);
      return data;
    } catch (e) {
      console.warn('[SSCLive] fetch failed:', url, e.message);
      return null;
    }
  }

  // ── SCOREBOARD ────────────────────────────────────────────────
  async function getScoreboard(leagueKey) {
    const map = LEAGUE_MAP[leagueKey];
    if (!map) return null;
    const url = `${ESPN_BASE}/${map.sport}/${map.league}/scoreboard`;
    return espnFetch(url, `scoreboard:${leagueKey}`, 'scoreboard');
  }

  // ── GAME SUMMARY (box score + play-by-play) ───────────────────
  async function getGameSummary(leagueKey, eventId) {
    const map = LEAGUE_MAP[leagueKey];
    if (!map) return null;
    const url = `${ESPN_WEB}/${map.sport}/${map.league}/summary?event=${eventId}`;
    return espnFetch(url, `summary:${leagueKey}:${eventId}`, 'summary');
  }

  // ── STANDINGS ─────────────────────────────────────────────────
  async function getStandings(leagueKey) {
    const map = LEAGUE_MAP[leagueKey];
    if (!map) return null;
    const url = `${ESPN_BASE}/${map.sport}/${map.league}/standings`;
    return espnFetch(url, `standings:${leagueKey}`, 'standings');
  }

  // ── EVENT EMITTER ─────────────────────────────────────────────
  const listeners = {};
  function on(evt, cb) {
    if (!listeners[evt]) listeners[evt] = [];
    listeners[evt].push(cb);
  }
  function emit(evt, data) {
    (listeners[evt] || []).forEach(cb => { try { cb(data); } catch(e) {} });
  }

  // ── POLLING ──────────────────────────────────────────────────
  let scoreboardTimer = null, summaryTimer = null;
  let currentLeague = null, currentEventId = null;

  function isGameHour() {
    const h = new Date().getHours();
    return h >= 11 && h <= 23; // 11am–11pm local
  }

  function startScoreboardPoll(leagueKey, intervalMs) {
    if (scoreboardTimer) clearInterval(scoreboardTimer);
    currentLeague = leagueKey;
    async function poll() {
      const data = await getScoreboard(leagueKey);
      if (data) emit('scoreboard', { league: leagueKey, data });
    }
    poll();
    scoreboardTimer = setInterval(poll, intervalMs || 30000);
  }

  function startSummaryPoll(leagueKey, eventId, intervalMs) {
    if (summaryTimer) clearInterval(summaryTimer);
    currentEventId = eventId;
    async function poll() {
      const data = await getGameSummary(leagueKey, eventId);
      if (!data) return;
      if (data.boxscore)  emit('boxscore', { league: leagueKey, eventId, data: data.boxscore });
      if (data.plays)     emit('plays',    { league: leagueKey, eventId, data: data.plays });
      if (data.header)    emit('header',   { league: leagueKey, eventId, data: data.header });
      emit('summary', { league: leagueKey, eventId, data });
    }
    poll();
    summaryTimer = setInterval(poll, intervalMs || 15000);
  }

  function stop() {
    if (scoreboardTimer) { clearInterval(scoreboardTimer); scoreboardTimer = null; }
    if (summaryTimer)    { clearInterval(summaryTimer);    summaryTimer    = null; }
  }

  // ── DATA PARSERS ─────────────────────────────────────────────

  // Parse scoreboard events into simple card objects
  function parseScoreboard(data) {
    if (!data || !data.events) return [];
    return data.events.map(ev => {
      const comps = ev.competitions?.[0] || {};
      const teams = comps.competitors || [];
      const status = comps.status || {};
      const home = teams.find(t => t.homeAway === 'home') || teams[0] || {};
      const away = teams.find(t => t.homeAway === 'away') || teams[1] || {};
      return {
        id:          ev.id,
        name:        ev.name,
        shortName:   ev.shortName,
        date:        ev.date,
        status:      status.type?.description || 'Scheduled',
        statusShort: status.type?.shortDetail || '',
        isLive:      status.type?.state === 'in',
        isFinal:     status.type?.completed === true,
        period:      status.period || 0,
        clock:       status.displayClock || '',
        homeTeam:    home.team?.displayName || '',
        homeAbbr:    home.team?.abbreviation || '',
        homeLogo:    home.team?.logo || '',
        homeScore:   home.score || '0',
        homeRecord:  home.records?.[0]?.summary || '',
        awayTeam:    away.team?.displayName || '',
        awayAbbr:    away.team?.abbreviation || '',
        awayLogo:    away.team?.logo || '',
        awayScore:   away.score || '0',
        awayRecord:  away.records?.[0]?.summary || '',
        venue:       comps.venue?.fullName || '',
        broadcast:   comps.broadcasts?.[0]?.names?.[0] || '',
        odds:        comps.odds?.[0]?.details || '',
      };
    });
  }

  // Parse plays array into feed items
  function parsePlays(plays, sport) {
    if (!plays) return [];
    return plays.map(p => {
      const base = {
        id:          p.id,
        text:        p.text || p.description || '',
        clock:       p.clock?.displayValue || p.clock || '',
        period:      p.period?.displayValue || p.period?.number || '',
        homeScore:   p.homeScore || '',
        awayScore:   p.awayScore || '',
        scoringPlay: p.scoringPlay || false,
        type:        p.type?.text || p.type?.abbreviation || '',
        team:        p.team?.displayName || '',
        teamAbbr:    p.team?.abbreviation || '',
      };
      // Sport-specific extras
      if (sport === 'nfl' || sport === 'ncaaf') {
        base.down         = p.start?.down || '';
        base.distance     = p.start?.distance || '';
        base.yardLine     = p.start?.yardLine || '';
        base.possession   = p.start?.possessionText || '';
        base.yards        = p.statYardage || 0;
      }
      if (sport === 'mlb') {
        base.balls        = p.pitchCount?.balls || 0;
        base.strikes      = p.pitchCount?.strikes || 0;
        base.outs         = p.outs || 0;
        base.pitcher      = p.pitcher?.displayName || '';
        base.batter       = p.batter?.displayName || '';
        base.pitchType    = p.pitchType?.displayName || '';
        base.pitchSpeed   = p.pitchVelocity || '';
        base.result       = p.pitchResult?.displayName || '';
      }
      if (sport === 'nba' || sport === 'ncaab') {
        base.shooter      = p.athlete?.displayName || '';
        base.assistBy     = p.assists?.[0]?.displayName || '';
      }
      return base;
    }).reverse(); // most recent first
  }

  // Parse box score into team stat rows
  function parseBoxScore(boxscore, sport) {
    if (!boxscore) return null;
    const teams = boxscore.teams || [];
    return teams.map(t => ({
      team:  t.team?.displayName || '',
      abbr:  t.team?.abbreviation || '',
      logo:  t.team?.logo || '',
      stats: (t.statistics || []).map(s => ({
        label: s.label || s.name,
        abbr:  s.abbreviation || s.label,
        value: s.displayValue,
      })),
    }));
  }

  // ── UI RENDERERS ─────────────────────────────────────────────

  // Inject live scores into an existing .scores-grid container
  function renderScoreCards(games, containerId, gameUrl) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!games.length) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.84rem;padding:16px 0">No games scheduled today.</p>';
      return;
    }

    container.innerHTML = games.map(g => {
      const live     = g.isLive;
      const final    = g.isFinal;
      const sched    = !live && !final;
      const statusColor = live ? '#22c55e' : final ? 'var(--muted)' : '#38BDF8';
      const homeWin  = final && parseInt(g.homeScore) > parseInt(g.awayScore);
      const awayWin  = final && parseInt(g.awayScore) > parseInt(g.homeScore);

      return `<div class="score-card" onclick="window.location='${gameUrl || '#'}?event=${g.id}'" style="cursor:pointer">
        ${live ? '<div class="live-badge" style="background:rgba(34,197,94,.15);border:1px solid #22c55e;color:#22c55e;font-family:JetBrains Mono,monospace;font-size:.6rem;font-weight:700;letter-spacing:.1em;padding:2px 8px;border-radius:4px;margin-bottom:6px;display:inline-block">● LIVE</div>' : ''}
        <div class="score-hdr" style="color:${statusColor}">${live ? g.statusShort || g.status : (sched ? new Date(g.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) : 'Final')}</div>
        <div class="score-row">
          <span class="score-team">
            <img src="${g.awayLogo}" style="width:18px;height:18px;object-fit:contain;vertical-align:-.2em;margin-right:4px" onerror="this.style.display='none'"/>
            ${g.awayTeam}
            ${g.awayRecord ? `<span style="font-size:.68rem;color:var(--muted);margin-left:4px">${g.awayRecord}</span>` : ''}
          </span>
          <span class="score-val${awayWin ? ' w' : ''}">${sched ? '' : g.awayScore}</span>
        </div>
        <div class="score-div"></div>
        <div class="score-row">
          <span class="score-team">
            <img src="${g.homeLogo}" style="width:18px;height:18px;object-fit:contain;vertical-align:-.2em;margin-right:4px" onerror="this.style.display='none'"/>
            ${g.homeTeam}
            ${g.homeRecord ? `<span style="font-size:.68rem;color:var(--muted);margin-left:4px">${g.homeRecord}</span>` : ''}
          </span>
          <span class="score-val${homeWin ? ' w' : ''}">${sched ? '' : g.homeScore}</span>
        </div>
        ${live ? `<div style="font-size:.7rem;color:#22c55e;margin-top:6px;font-family:JetBrains Mono,monospace">${g.clock} · ${g.period}</div>` : ''}
        ${sched ? `<div style="font-size:.72rem;color:var(--muted);margin-top:4px">${new Date(g.date).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} ${g.broadcast ? '· '+g.broadcast : ''}</div>` : ''}
      </div>`;
    }).join('');
  }

  // Render PBP feed into existing .pbp-feed container
  function renderPBPFeed(plays, sport, containerId) {
    const container = document.getElementById(containerId || 'pbp-feed');
    if (!container) return;
    if (!plays.length) {
      container.innerHTML = '<div class="pbp-item"><div class="pbp-item-text">Waiting for game to start…</div></div>';
      return;
    }

    container.innerHTML = plays.slice(0, 50).map((p, i) => {
      const isScore = p.scoringPlay;
      const meta = sport === 'nfl'
        ? (p.down ? `${p.down}${p.distance ? ' & '+p.distance : ''} · ${p.possession}` : p.period)
        : sport === 'mlb'
        ? `${p.balls}-${p.strikes} · ${p.outs} out${p.outs !== 1 ? 's' : ''}`
        : `${p.period} · ${p.clock}`;

      return `<div class="pbp-item${isScore ? ' td' : ''}${i === 0 ? ' active' : ''}">
        <div class="pbp-icon">${isScore ? '🏈' : sport === 'mlb' ? '⚾' : sport === 'nba' ? '🏀' : '▶'}</div>
        <div style="flex:1;min-width:0">
          <div class="pbp-item-play">${p.text}</div>
          <div class="pbp-item-meta">${meta}${p.teamAbbr ? ' · ' + p.teamAbbr : ''}</div>
        </div>
        ${isScore ? `<div class="pbp-score-badge">${p.awayScore}–${p.homeScore}</div>` : ''}
      </div>`;
    }).join('');
  }

  // Render live score header on gameday page
  function renderGameHeader(header, sport) {
    const comps = header?.competitions?.[0];
    if (!comps) return;

    const teams    = comps.competitors || [];
    const status   = comps.status || {};
    const home     = teams.find(t => t.homeAway === 'home') || {};
    const away     = teams.find(t => t.homeAway === 'away') || {};
    const isLive   = status.type?.state === 'in';
    const isFinal  = status.type?.completed;

    // Update score display if elements exist
    const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    const setHtml = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };

    setEl('live-home-score', home.score || '0');
    setEl('live-away-score', away.score || '0');
    setEl('live-game-status', status.type?.shortDetail || status.type?.description || '');

    // Live badge
    const badge = document.getElementById('live-badge');
    if (badge) {
      badge.style.display = isLive ? 'inline-block' : 'none';
      if (isLive) badge.textContent = '● LIVE';
    }

    // Quarter/inning/period
    setEl('live-period', status.type?.shortDetail || '');
    setEl('live-clock', status.displayClock || '');
  }

  // ── INIT FOR LEAGUE INDEX PAGES ──────────────────────────────
  function init(leagueKey, options) {
    const opts = options || {};

    // Start scoreboard polling
    startScoreboardPoll(leagueKey, opts.interval || 30000);

    on('scoreboard', ({ data }) => {
      const games = parseScoreboard(data);

      // Render into score cards grid
      const gridId = opts.scoreGridId || 'live-scores-grid';
      const gameUrl = opts.gamedayUrl || `/${leagueKey}/gameday.html`;
      renderScoreCards(games, gridId, gameUrl);

      // Update "last updated" timestamp
      const ts = document.getElementById('live-timestamp');
      if (ts) ts.textContent = '// Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      // Show live count badge in tab
      const liveCount = games.filter(g => g.isLive).length;
      const livePill = document.getElementById('live-count-pill');
      if (livePill) {
        livePill.textContent = liveCount > 0 ? liveCount + ' LIVE' : '';
        livePill.style.display = liveCount > 0 ? 'inline-block' : 'none';
      }
    });
  }

  // ── INIT FOR GAMEDAY PAGES ───────────────────────────────────
  function initGameday(leagueKey, eventId, options) {
    const opts = options || {};
    const sport = leagueKey;

    if (!eventId) {
      // Try to get event ID from URL param
      const params = new URLSearchParams(window.location.search);
      eventId = params.get('event') || opts.defaultEventId;
    }

    if (!eventId) {
      console.warn('[SSCLive] No event ID — showing static data');
      return;
    }

    startSummaryPoll(leagueKey, eventId, opts.interval || 15000);

    on('header',   ({ data }) => renderGameHeader(data, sport));
    on('boxscore', ({ data }) => {
      const teams = parseBoxScore(data, sport);
      if (teams && opts.onBoxScore) opts.onBoxScore(teams);
    });
    on('plays', ({ data }) => {
      const plays = parsePlays(data, sport);
      renderPBPFeed(plays, sport, opts.pbpContainerId);
      if (opts.onPlays) opts.onPlays(plays);
    });
  }

  // ── EXPOSE PUBLIC API ────────────────────────────────────────
  global.SSCLive = {
    init,
    initGameday,
    on,
    stop,
    getScoreboard,
    getGameSummary,
    getStandings,
    parseScoreboard,
    parsePlays,
    parseBoxScore,
    renderScoreCards,
    renderPBPFeed,
    LEAGUE_MAP,
  };

})(window);
