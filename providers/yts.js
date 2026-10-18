'use strict';

// ============ CONFIG ============
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const YTS_API_BASE = 'https://movies-api.accel.li/api/v2';
const PROVIDER = 'YTS';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Accept': 'application/json'
};

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://open.demonii.com:1337/announce',
  'https://tracker.moeblog.cn:443/announce',
  'udp://open.dstud.io:6969/announce',
  'udp://tracker.srv00.com:6969/announce',
  'https://tracker.zhuqiy.com:443/announce',
  'https://tracker.pmman.tech:443/announce'
];

// ============ TARGET QUALITY ============
const TARGET_QUALITY = '1080p';
const QUALITY_LABEL = '1080p';
// =========================================

// ============ HELPERS ============
function resolveSettings(userSettings) {
  let settings = { sortBy: 'seeders' };
  try {
    let src = userSettings;
    if (!src && typeof globalThis !== 'undefined') src = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!src && typeof global !== 'undefined') src = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!src && typeof window !== 'undefined') src = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (src && src.sortBy) settings.sortBy = String(src.sortBy).trim();
  } catch (e) {
    console.error('[' + PROVIDER + '] settings error:', e);
  }
  return settings;
}

function buildMagnet(hash) {
  if (!hash) return '';
  const trackers = TRACKERS.map(t => '&tr=' + encodeURIComponent(t)).join('');
  return 'magnet:?xt=urn:btih:' + hash + trackers;
}

function parseSizeBytes(sizeStr, torrent) {
  if (typeof torrent?.size === 'number' && torrent.size > 0) return Math.floor(torrent.size);
  if (typeof torrent?.bytes === 'number' && torrent.bytes > 0) return Math.floor(torrent.bytes);
  const m = String(sizeStr).match(/([0-9.]+)\s*([GM]B)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === 'GB') return Math.floor(val * 1073741824);
  if (unit === 'MB') return Math.floor(val * 1048576);
  return 0;
}

function getInvertedSortTag(num, max) {
  max = max || 999999;
  const n = Math.max(0, parseInt(num, 10) || 0);
  const inverted = Math.max(0, max - n);
  const bin = inverted.toString(2).padStart(20, '0');
  return bin.split('').map(b => b === '1' ? '\uFEFF' : '\u200B').join('');
}

// ============ MAIN: getStreams ============
function getStreams(mediaId, mediaType = 'movie', season = null, episode = null, userSettings = null) {
  return (async function () {
    const settings = resolveSettings(userSettings);

    try {
      // 1. TMDB → IMDb ID
      const tmdbUrl = 'https://api.themoviedb.org/3/movie/' + mediaId + '?api_key=' + TMDB_API_KEY + '&append_to_response=external_ids';
      const tmdb = await fetch(tmdbUrl).then(r => r.json()).catch(() => null);
      const imdbId = tmdb?.external_ids?.imdb_id || tmdb?.imdb_id || mediaId;
      const title = tmdb?.title || 'Unknown';
      const year = (tmdb?.release_date || 'N/A').split('-')[0];

      // 2. YTS-compatible API
      const url = YTS_API_BASE + '/list_movies.json?query_term=' + encodeURIComponent(imdbId);
      const data = await fetch(url, { headers: HEADERS }).then(r => r.json()).catch(() => null);

      if (!data?.data?.movies?.length) return [];

      const results = [];

      for (const movie of data.data.movies) {
        for (const torrent of (movie.torrents || [])) {
          if (torrent.quality !== TARGET_QUALITY) continue;

          const seeds = parseInt(torrent.seeds) || 0;
          const sizeStr = torrent.size || 'N/A';
          const sizeBytes = parseSizeBytes(sizeStr, torrent);
          const sizeGB = Math.floor(sizeBytes / 1073741824);
          const magnet = buildMagnet(torrent.hash);

          const extras = [];
          if (torrent.video_codec) extras.push(torrent.video_codec.toUpperCase());
          if (torrent.bit_depth) extras.push(torrent.bit_depth + '-bit');
          if (torrent.audio_channels) extras.push('AUDIO ' + torrent.audio_channels);

          const titleLine = '\uD83C\uDFAC ' + title + ' - ' + year;
          const qualityLine = '\uD83D\uDD25 ' + QUALITY_LABEL + ' | ' + extras.join(' | ');
          const statsLine = '\uD83C\uDF31 ' + seeds + ' | \uD83D\uDCBE ' + sizeStr + ' | \uD83D\uDD17 YTS';
          const description = titleLine + '\n' + qualityLine + '\n' + statsLine;

          let sortTag;
          if (settings.sortBy === 'size') sortTag = getInvertedSortTag(sizeGB);
          else sortTag = getInvertedSortTag(seeds);

          const streamName = sortTag + '\uD83E\uDD85 YTS | ' + QUALITY_LABEL.toUpperCase() + ' | \uD83C\uDF31 ' + seeds;

          results.push({
            seeders: seeds,
            sizeBytes,
            data: {
              name: streamName,
              title: description,
              size: description,
              description,
              url: magnet
            }
          });
        }
      }

      results.sort((a, b) => {
        if (settings.sortBy === 'size') return b.sizeBytes - a.sizeBytes;
        return b.seeders - a.seeders;
      });

      return results.map(r => r.data);

    } catch (err) {
      console.error('[' + PROVIDER + '] Execution error:', err);
      return [];
    }
  })();
}

// ============ SETTINGS ============
function onSettings() {
  return (async function () {
    return [
      { type: 'header', label: 'YTS Scraper' },
      {
        type: 'select',
        key: 'sortBy',
        label: 'Sort results by',
        options: [
          { label: 'Seeders', value: 'seeders' },
          { label: 'Size', value: 'size' }
        ],
        default: 'seeders'
      }
    ];
  })();
}

module.exports = { getStreams, onSettings };
