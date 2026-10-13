'use strict';

// ============ CONFIG ============
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const DEFAULT_PROVIDER = 'MultiTV';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Accept': 'application/json'
};

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce'
];

// ============ TARGET QUALITY — 1080p ONLY ============
const TARGET_QUALITY = '1080p';
const QUALITY_RANK = 3;
const QUALITY_LABEL = '1080p';

// ============ MINIMUM SEEDERS ============
const MIN_SEEDS = 15;
// =======================================

// ============ HELPERS ============
function resolveSettings(userSettings) {
  let settings = { debridProvider: 'none', debridKey: '', language: 'any', minQuality: TARGET_QUALITY, sortBy: 'seeders' };
  try {
    let src = userSettings;
    if (!src && typeof globalThis !== 'undefined') src = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!src && typeof global !== 'undefined') src = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!src && typeof window !== 'undefined') src = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (src) {
      if (src.debridProvider) settings.debridProvider = String(src.debridProvider).toLowerCase().trim();
      if (src.debridKey) settings.debridKey = String(src.debridKey).trim();
      if (src.language) settings.language = String(src.language).trim();
      if (src.minQuality) settings.minQuality = String(src.minQuality).trim();
      if (src.sortBy) settings.sortBy = String(src.sortBy).trim();
    }
  } catch (e) { console.error('[' + DEFAULT_PROVIDER + '] settings error:', e); }
  return settings;
}

function buildMagnet(hash, name) {
  if (!hash) return '';
  const trackers = TRACKERS.map(t => '&tr=' + encodeURIComponent(t)).join('');
  const dn = name ? '&dn=' + encodeURIComponent(name) : '';
  return 'magnet:?xt=urn:btih:' + hash + dn + trackers;
}

function getInvertedSortTag(num, max) {
  max = max || 999999;
  const n = Math.max(0, parseInt(num, 10) || 0);
  const inverted = Math.max(0, max - n);
  const bin = inverted.toString(2).padStart(20, '0');
  return bin.split('').map(b => b === '1' ? '\uFEFF' : '\u200B').join('');
}

function normalizeImdbId(imdbId) {
  if (!imdbId) return '';
  return String(imdbId).replace(/^tt/i, '').replace(/\D/g, '');
}

// ============ TITLE NORMALIZATION ============
function normalizeTitle(title) {
  if (!title) return '';
  return String(title)
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function titleWords(title) {
  return normalizeTitle(title).split(/\s+/).filter(w => w.length > 2);
}

// ============ FLEXIBLE S/E PATTERNS ============
function buildSePatterns(season, episode) {
  const s = String(season);
  const e = String(episode);
  const sPad = s.padStart(2, '0');
  const ePad = e.padStart(2, '0');
  return [
    new RegExp('S' + sPad + '[\\s._-]?E' + ePad, 'i'),
    new RegExp('\\b' + s + 'x' + ePad + '\\b', 'i'),
    new RegExp('Season[\\s._-]?' + s + '[\\s._-]?Episode[\\s._-]?' + e, 'i'),
    new RegExp('S' + sPad + '[\\s._-]?' + ePad, 'i'),
    new RegExp('\\b' + sPad + ePad + '\\b', 'i')
  ];
}

function matchesSe(name, season, episode) {
  const patterns = buildSePatterns(season, episode);
  return patterns.some(p => p.test(name));
}

// ============ STRICT 1080p FILTER ============
function is1080p(filename) {
  return /\b1080p\b|\bFHD\b/i.test(filename);
}

// ============ SOURCE 1: EZTV ============
async function fetchEztv(imdbId, title, season, episode, settings) {
  try {
    const url = 'https://eztvx.to/api/get-torrents?imdb_id=' + imdbId + '&limit=100';
    const data = await fetch(url, { headers: HEADERS }).then(r => r.json()).catch(() => null);
    if (!data?.torrents || !Array.isArray(data.torrents)) return [];

    const out = [];
    for (const t of data.torrents) {
      if (!t || !t.hash || !t.filename) continue;
      if (String(t.season) !== String(season) || String(t.episode) !== String(episode)) continue;
      if (!is1080p(t.filename)) continue;  // STRICT 1080p

      const seeds = parseInt(t.seeds) || 0;
      if (seeds < MIN_SEEDS) continue;  // MINIMUM 15 SEEDS

      out.push({
        source: 'EZTV',
        hash: t.hash,
        filename: t.filename,
        seeds: seeds,
        peers: parseInt(t.peers) || 0,
        sizeBytes: parseInt(t.size_bytes) || 0,
        qualityRank: QUALITY_RANK,
        qualityLabel: QUALITY_LABEL,
        magnet: t.magnet_url || buildMagnet(t.hash, t.filename)
      });
    }
    return out;
  } catch (e) {
    console.error('[EZTV] error:', e?.message || e);
    return [];
  }
}

// ============ SOURCE 2: 1337x (via apibay alt queries) ============
async function fetch1337x(title, season, episode, settings) {
  try {
    const queries = [
      title + ' S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0') + ' 1080p',
      title + ' S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0') + ' x265'
    ];
    const seen = new Set();
    const all = [];
    for (const q of queries) {
      try {
        const url = 'https://apibay.org/q.php?q=' + encodeURIComponent(q) + '&cat=0';
        const arr = await fetch(url, { headers: HEADERS }).then(r => r.json()).catch(() => null);
        if (Array.isArray(arr)) {
          for (const t of arr) {
            if (t && t.info_hash && !seen.has(t.info_hash) && t.info_hash !== '0000000000000000000000000000000000000000') {
              seen.add(t.info_hash);
              all.push(t);
            }
          }
        }
      } catch (_) {}
    }

    const out = [];
    const tWords = titleWords(title);

    for (const t of all) {
      if (!matchesSe(t.name, season, episode)) continue;
      if (!is1080p(t.name)) continue;  // STRICT 1080p

      const seeds = parseInt(t.seeders) || 0;
      if (seeds < MIN_SEEDS) continue;  // MINIMUM 15 SEEDS

      const nameNorm = normalizeTitle(t.name);
      const matched = tWords.filter(w => nameNorm.includes(w));
      if (matched.length < Math.max(1, Math.floor(tWords.length * 0.5))) continue;

      out.push({
        source: '1337x',
        hash: t.info_hash,
        filename: t.name,
        seeds: seeds,
        peers: parseInt(t.leechers) || 0,
        sizeBytes: parseInt(t.size) || 0,
        qualityRank: QUALITY_RANK,
        qualityLabel: QUALITY_LABEL,
        magnet: buildMagnet(t.info_hash, t.name)
      });
    }
    return out;
  } catch (e) {
    console.error('[1337x] error:', e?.message || e);
    return [];
  }
}

// ============ MAIN: getStreams ============
function getStreams(mediaId, mediaType = 'movie', season = null, episode = null, userSettings = null) {
  return (async function () {
    if (mediaType !== 'tv' && mediaType !== 'series') return [];

    const settings = resolveSettings(userSettings);
    const seasonNum = parseInt(season) || 1;
    const episodeNum = parseInt(episode) || 1;

    try {
      // 1. TMDB → IMDb ID + title
      const tmdbUrl = 'https://api.themoviedb.org/3/tv/' + mediaId + '?api_key=' + TMDB_API_KEY + '&append_to_response=external_ids';
      const tmdb = await fetch(tmdbUrl).then(r => r.json()).catch(() => null);
      const rawImdbId = tmdb?.external_ids?.imdb_id || tmdb?.imdb_id || '';
      const title = tmdb?.name || tmdb?.original_name || 'Unknown';
      const imdbId = normalizeImdbId(rawImdbId);

      if (title === 'Unknown' && !imdbId) return [];

      // 2. Kunin mula sa DALAWANG sources — sabay-sabay
      const promises = [];

      if (imdbId) {
        promises.push(fetchEztv(imdbId, title, seasonNum, episodeNum, settings));
      }
      if (title && title !== 'Unknown') {
        promises.push(fetch1337x(title, seasonNum, episodeNum, settings));
      }

      const settled = await Promise.allSettled(promises);
      const merged = [];
      for (const s of settled) {
        if (s.status === 'fulfilled' && Array.isArray(s.value)) {
          merged.push(...s.value);
        }
      }

      // 3. Dedupe ayon sa hash
      const seen = new Set();
      const unique = [];
      for (const item of merged) {
        if (!item.hash || seen.has(item.hash)) continue;
        seen.add(item.hash);
        unique.push(item);
      }

      if (!unique.length) return [];

      // 4. Build results
      const results = unique.map(item => {
        const sizeGB = (item.sizeBytes / 1073741824).toFixed(2);
        const extras = [];
        if (/\bX265\b|\bH\.?265\b|\bHEVC\b/i.test(item.filename)) extras.push('X265');
        else if (/\bX264\b|\bH\.?264\b|\bAVC\b/i.test(item.filename)) extras.push('X264');
        if (/\bHDR10\+?\b/i.test(item.filename)) extras.push('HDR10');
        else if (/\bHDR\b/i.test(item.filename)) extras.push('HDR');
        if (/\bATMOS\b/i.test(item.filename)) extras.push('ATMOS');
        if (/\bDTS\b/i.test(item.filename)) extras.push('DTS');
        if (/\b5\.1\b/i.test(item.filename)) extras.push('5.1');

        const titleLine = '\uD83C\uDFA6 ' + title + ' S' + String(seasonNum).padStart(2, '0') + ' E' + String(episodeNum).padStart(2, '0');
        const qualityLine = '\uD83D\uDD25 ' + QUALITY_LABEL + (extras.length ? ' | ' + extras.join(' | ') : '');
        const statsLine = '\uD83C\uDF31 ' + item.seeds + ' | \uD83D\uDCBE ' + sizeGB + ' GB | \uD83D\uDD17 ' + item.source;
        const description = titleLine + '\n' + qualityLine + '\n' + statsLine;

        return {
          seeders: item.seeds,
          sizeBytes: item.sizeBytes,
          qualityRank: QUALITY_RANK,
          data: {
            name: item.source + ' | ' + QUALITY_LABEL.toUpperCase() + ' | \uD83C\uDF31 ' + item.seeds,
            title: description,
            size: description,
            description,
            url: item.magnet
          }
        };
      });

      // ============ SORTING — SEEDERS PRIORITY ============
      results.sort((a, b) => {
        // Primary: Seeders (mas mataas, mas mauna)
        if (b.seeders !== a.seeders) return b.seeders - a.seeders;
        // Secondary: Size (mas maliit, mas mauna)
        return a.sizeBytes - b.sizeBytes;
      });

      // 6. Apply inverted sort tag — seeders priority
      return results.map(r => {
        const sortTag = getInvertedSortTag(r.seeders);
        return { ...r.data, name: sortTag + r.data.name };
      });

    } catch (err) {
      console.error('[' + DEFAULT_PROVIDER + '] Fatal error:', err);
      return [];
    }
  })();
}

// ============ SETTINGS ============
function onSettings() {
  return (async function () {
    return [
      { type: 'header', label: 'EZTV + 1337x — 1080p Only + 15+ Seeds' },
      {
        type: 'select',
        key: 'sortBy',
        label: 'Sort results by',
        options: [
          { label: 'Seeders (recommended)', value: 'seeders' },
          { label: 'Size', value: 'size' }
        ],
        default: 'seeders'
      }
    ];
  })();
}

module.exports = { getStreams, onSettings };