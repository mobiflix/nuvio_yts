'use strict';

// ============ CONFIG ============
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const YTS_API_BASE = 'https://movies-api.accel.li/api/v2';
const DEFAULT_PROVIDER = 'YTS';

const KNOWN_PROVIDERS = ['YTS','EZTV','RARBG','Torrentio','Bitmagnet','Prowlarr','1337x','ThePirateBay','KickassTorrents','Torlock','Zooqle','Torrentz2','BitSearch','LimeTorrents'];

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

// ============ TARGET QUALITY (ITO ANG TANGING IBA SA BAWAT FILE) ============
const TARGET_QUALITY = '1080p';
const QUALITY_RANK = 3;
const QUALITY_LABEL = '1080p';
// ============================================================================

// ============ HELPERS ============
function resolveSettings(userSettings) {
  let settings = {
    debridProvider: 'none',
    debridKey: '',
    language: 'any',
    minQuality: TARGET_QUALITY,
    sortBy: 'seeders'
  };
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
  } catch (e) {
    console.error('[' + DEFAULT_PROVIDER + '] settings error:', e);
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

function getQualityRank(str) {
  const s = String(str).toUpperCase();
  if (s.includes('2160') || s.includes('4K') || s.includes('UHD')) return 4;
  if (s.includes('1080') || s.includes('FHD')) return 3;
  if (s.includes('720') || s.includes('HD')) return 2;
  if (s.includes('480') || s.includes('SD')) return 1;
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
    const isSeries = mediaType === 'tv' || mediaType === 'series';

    try {
      // 1. TMDB → IMDb ID
      const tmdbUrl = 'https://api.themoviedb.org/3/' + (isSeries ? 'tv' : 'movie') + '/' + mediaId + '?api_key=' + TMDB_API_KEY + '&append_to_response=external_ids';
      const tmdb = await fetch(tmdbUrl).then(r => r.json()).catch(() => null);
      const imdbId = tmdb?.external_ids?.imdb_id || tmdb?.imdb_id || mediaId;
      const title = tmdb?.title || tmdb?.name || 'Unknown';
      const year = (tmdb?.release_date || tmdb?.first_air_date || 'N/A').split('-')[0];

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

          const titleLine = isSeries
            ? '\uD83C\uDFA6 ' + title + ' S' + (season || 1) + ' E' + (episode || 1)
            : '\uD83C\uDFAC ' + title + ' - ' + year;
          const qualityLine = '\uD83D\uDD25 ' + QUALITY_LABEL + ' | ' + extras.join(' | ');
          const statsLine = '\uD83C\uDF31 ' + seeds + ' | \uD83D\uDCBE ' + sizeStr + ' | \uD83D\uDD17 YTS';
          const description = titleLine + '\n' + qualityLine + '\n' + statsLine;

          let sortTag;
          if (settings.sortBy === 'size') sortTag = getInvertedSortTag(sizeGB);
          else if (settings.sortBy === 'quality') sortTag = getInvertedSortTag(QUALITY_RANK * 10000 + seeds);
          else sortTag = getInvertedSortTag(seeds);

          const streamName = sortTag + '\uD83E\uDD85 YTS | ' + QUALITY_LABEL.toUpperCase() + ' | \uD83C\uDF31 ' + seeds;

          results.push({
            seeders: seeds,
            sizeBytes,
            qualityRank: QUALITY_RANK,
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
        if (settings.sortBy === 'quality') {
          if (b.qualityRank !== a.qualityRank) return b.qualityRank - a.qualityRank;
          return b.seeders - a.seeders;
        }
        return b.seeders - a.seeders;
      });

      return results.map(r => r.data);

    } catch (err) {
      console.error('[' + DEFAULT_PROVIDER + '] Execution error:', err);
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
        key: 'debridProvider',
        label: 'Debrid provider',
        options: [
          { label: 'None', value: 'none' },
          { label: 'TorBox — recommended', value: 'torbox' },
          { label: 'Torrin', value: 'torrin' },
          { label: 'AllDebrid', value: 'alldebrid' },
          { label: 'Premiumize', value: 'premiumize' },
          { label: 'RealDebrid', value: 'realdebrid' }
        ],
        default: 'none'
      },
      {
        type: 'password',
        isPassword: true,
        key: 'debridKey',
        label: 'Debrid API key',
        placeholder: 'Paste your provider API key',
        description: 'Free. Your key is encrypted on server — it never travels in clear.'
      },
      { type: 'header', label: 'Basics' },
      {
        type: 'select',
        key: 'language',
        label: 'Preferred Language',
        description: 'Streams in your language appear first with \u2B50\uFE0F',
        options: [
          { label: 'Any', value: 'any' },
          { label: '\uD83C\uDDEC\uD83C\uDDE7 English', value: 'en' },
          { label: '\uD83C\uDDFA\uD83C\uDDF8 English (US)', value: 'en-us' },
          { label: '\uD83C\uDDEC\uD83C\uDDE7 English (UK)', value: 'en-uk' },
          { label: '\uD83C\uDDEA\uD83C\uDDF8 Español', value: 'es' },
          { label: '\uD83C\uDDEA\uD83C\uDDF8 Español (España)', value: 'es-es' },
          { label: '\uD83C\uDDEA\uD83C\uDDF8 Español (LatAm)', value: 'es-la' },
          { label: '\uD83C\uDDEB\uD83C\uDDF7 Français', value: 'fr' },
          { label: '\uD83C\uDDEB\uD83C\uDDF7 Français (France)', value: 'fr-fr' },
          { label: '\uD83C\uDDEB\uD83C\uDDF7 Français (Canada)', value: 'fr-ca' },
          { label: '\uD83C\uDDF5\uD83C\uDDF9 Português', value: 'pt' },
          { label: '\uD83C\uDDE7\uD83C\uDDF7 Português (Brasil)', value: 'pt-br' },
          { label: '\uD83C\uDDF5\uD83C\uDDF9 Português (Portugal)', value: 'pt-pt' },
          { label: '\uD83C\uDDE9\uD83C\uDDEA Deutsch', value: 'de' },
          { label: '\uD83C\uDDEE\uD83C\uDDF9 Italiano', value: 'it' },
          { label: '\uD83C\uDDF7\uD83C\uDDFA Русский', value: 'ru' },
          { label: '\uD83C\uDDEF\uD83C\uDDF5 日本語', value: 'ja' },
          { label: '\uD83C\uDDF0\uD83C\uDDF7 한국어', value: 'ko' },
          { label: '\uD83C\uDDE8\uD83C\uDDF3 中文', value: 'zh' },
          { label: '\uD83C\uDDF8\uD83C\uDDE6 العربية', value: 'ar' },
          { label: '\uD83C\uDDEE\uD83C\uDDF3 हिन्दी', value: 'hi' },
          { label: '\uD83C\uDDF3\uD83C\uDDF1 Nederlands', value: 'nl' },
          { label: '\uD83C\uDDF5\uD83C\uDDF1 Polski', value: 'pl' },
          { label: '\uD83C\uDDF9\uD83C\uDDF7 Türkçe', value: 'tr' },
          { label: '\uD83C\uDDF8\uD83C\uDDEA Svenska', value: 'sv' }
        ],
        default: 'any'
      },
      {
        type: 'select',
        key: 'sortBy',
        label: 'Sort results by',
        options: [
          { label: 'Seeders', value: 'seeders' },
          { label: 'Quality', value: 'quality' },
          { label: 'Size', value: 'size' }
        ],
        default: 'seeders'
      }
    ];
  })();
}

module.exports = { getStreams, onSettings };