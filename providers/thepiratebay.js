// providers/thepiratebay.js
// 1080p LANG + minimum 15 seeders

const API_URL = 'https://apibay.org';
const MIN_SEEDERS = 15;
const TMDB_API_KEY = 'e0a7266a5d0e95c36475f349d8bc0a5a';
const TMDB_BASE = 'https://api.themoviedb.org/3';

function fetchJson(url) {
  return fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json'
    }
  }).then(function(res) { return res.json(); });
}

function getTmdbInfo(tmdbId, type) {
  var url = TMDB_BASE + '/' + type + '/' + tmdbId +
            '?api_key=' + TMDB_API_KEY + '&language=en-US';
  return fetchJson(url)
    .then(function(data) {
      var title = type === 'movie' ? data.title : data.name;
      var date = type === 'movie' ? data.release_date : data.first_air_date;
      var year = date ? date.split('-')[0] : '';
      return { title: title || '', year: year };
    })
    .catch(function() {
      return { title: '', year: '' };
    });
}

function parseQuality(name) {
  var t = name || '';
  var is1080 = /1080[pP]/i.test(t);
  var is4K = /2160[pP]|4K|UHD/i.test(t);
  var is720 = /720[pP]/i.test(t);
  var is480 = /480[pP]|SD/i.test(t);
  var isHDR = /HDR10\+?|HDR/i.test(t);
  var isDV = /\bDV\b|Dolby[\s\-]?Vision/i.test(t);

  var codec = '';
  if (/x265|HEVC|H\.?265/i.test(t)) codec = 'HEVC';
  else if (/x264|AVC|H\.?264/i.test(t)) codec = 'x264';

  var audio = 'English';
  if (/DUAL|DUAL-AUDIO/i.test(t)) audio = 'Dual-Audio';
  else if (/MULTI|MULTI-AUDIO/i.test(t)) audio = 'Multi';

  var resolution = '1080p';
  var emoji = '⚔️';
  var rank = 3;
  if (is4K) { resolution = '2160p'; emoji = '👑'; rank = 4; }
  else if (is720) { resolution = '720p'; emoji = '🗡️'; rank = 2; }
  else if (is480) { resolution = '480p'; emoji = '📱'; rank = 1; }

  return {
    resolution: resolution,
    qualityEmoji: emoji,
    qualityRank: rank,
    isHDR: isHDR,
    isDV: isDV,
    codec: codec,
    audio: audio,
    is1080: is1080
  };
}

function buildMagnet(hash, name) {
  var trackers = [
    'udp://tracker.coppersurfer.tk:6969/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.openbittorrent.com:6969/announce'
  ];
  var tr = trackers.map(function(t) {
    return '&tr=' + encodeURIComponent(t);
  }).join('');
  return 'magnet:?xt=urn:btih:' + hash + '&dn=' + encodeURIComponent(name) + tr;
}

function formatSize(bytes) {
  var b = parseInt(bytes, 10);
  if (isNaN(b) || b === 0) return 'Unknown';
  var gb = b / (1024 * 1024 * 1024);
  if (gb >= 1) return gb.toFixed(2) + ' GB';
  var mb = b / (1024 * 1024);
  return mb.toFixed(0) + ' MB';
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = (mediaType === 'tv' || mediaType === 'series') ? 'tv' : 'movie';

  return getTmdbInfo(tmdbId, type)
    .then(function(info) {
      if (!info.title) return [];

      var query = info.title;
      if (type === 'movie' && info.year) {
        query += ' ' + info.year;
      } else if (type === 'tv' && season && episode) {
        query += ' S' + String(season).padStart(2, '0') +
                 'E' + String(episode).padStart(2, '0');
      }

      var searchUrl = API_URL + '/q.php?q=' + encodeURIComponent(query);
      return fetchJson(searchUrl);
    })
    .then(function(results) {
      if (!Array.isArray(results) || results.length === 0) return [];
      if (results[0].name === 'No results returned') return [];

      var streams = [];

      for (var i = 0; i < results.length; i++) {
        var item = results[i];
        if (!item.info_hash) continue;
        if (item.info_hash === '0000000000000000000000000000000000000000') continue;

        var name = item.name || '';
        var quality = parseQuality(name);
        var seeders = parseInt(item.seeders || '0', 10);

        // 1080p LANG
        if (!quality.is1080) continue;
        // MINIMUM 15 SEEDERS
        if (seeders < MIN_SEEDERS) continue;

        var magnet = buildMagnet(item.info_hash, name);

        streams.push({
          name: '☠️ TPB ' + quality.resolution.toUpperCase() + ' | 🦜' + seeders,
          title: name,
          url: magnet,
          quality: quality.resolution,
          size: formatSize(item.size),
          provider: 'The Pirate Bay'
        });
      }

      // Sort by seeders (pinakamarami muna)
      streams.sort(function(a, b) {
        var sa = parseInt((a.name.match(/🦜(\d+)/) || [0, 0])[1], 10);
        var sb = parseInt((b.name.match(/🦜(\d+)/) || [0, 0])[1], 10);
        return sb - sa;
      });

      return streams;
    })
    .catch(function(err) {
      console.error('[TPB] Error:', err);
      return [];
    });
}

function onSettings() {
  return [
    {
      type: 'header',
      label: 'The Pirate Bay Settings'
    },
    {
      type: 'select',
      key: 'quality',
      label: 'Quality (naka-lock sa 1080p)',
      options: [{ label: '1080p only', value: '1080p' }],
      default: '1080p'
    },
    {
      type: 'select',
      key: 'sortBy',
      label: 'Sort By',
      options: [
        { label: 'Seeders', value: 'seeders' },
        { label: 'Size', value: 'size' }
      ],
      default: 'seeders'
    }
  ];
}

module.exports = {
  getStreams: getStreams,
  onSettings: onSettings
};