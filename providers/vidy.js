const BASE_URL = "https://www.vidy.st/";
const API_BASE = "https://api.wecollege.net";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Referer": BASE_URL,
  "Origin": "https://www.vidy.st"
};

async function fetchText(url) {
  const headers = url.includes("api.wecollege.net") ? HEADERS : { "User-Agent": USER_AGENT, "Accept": "*/*" };
  const response = await fetch(url, { headers });
  if (response.status !== 200) throw new Error(`http_${response.status}`);
  return response.text();
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:/.test(value);
}

function decodeBase64Url(encoded) {
  const lookup = new Int16Array(128).fill(-1);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  lookup["-".charCodeAt(0)] = 62;
  lookup["_".charCodeAt(0)] = 63;
  const bytes = new Uint8Array(((encoded.length * 6) >> 3) + 1);
  let byteCount = 0, bitCount = 0, accumulator = 0;
  for (let i = 0; i < encoded.length; i++) {
    const charCode = encoded.charCodeAt(i);
    const sextet = charCode < 128 ? lookup[charCode] : -1;
    if (sextet < 0) continue;
    accumulator = ((accumulator << 6) | sextet) & 0xFFFFFF;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[byteCount++] = (accumulator >> bitCount) & 0xFF;
    }
  }
  return bytes.subarray(0, byteCount);
}

const imul = (a, b) => Math.imul(a, b) >>> 0;

function avalanche32(input) {
  let v = input >>> 0;
  v = (v ^ (v >>> 16)) >>> 0; v = imul(v, 0x85EBCA6B);
  v = (v ^ (v >>> 13)) >>> 0; v = imul(v, 0xC2B2AE35);
  return (v ^ (v >>> 16)) >>> 0;
}

function rotl32(value, shift) {
  const s = shift & 31;
  return s === 0 ? value >>> 0 : ((value << s) | (value >>> (32 - s))) >>> 0;
}

function hashFnv1a(text) {
  const bytes = new TextEncoder().encode(text);
  let hash = 0x811C9DC5;
  for (let i = 0; i < bytes.length; i++) hash = imul((hash ^ bytes[i]) >>> 0, 0x01000193);
  return avalanche32(hash);
}

function generateKeystream(seed, tmdbId, length) {
  const cells = new Uint32Array(61);
  const init = new Uint8Array(61);
  let s = avalanche32((hashFnv1a(seed) ^ avalanche32((tmdbId >>> 0) ^ 0x9E3779B9)) >>> 0);
  for (let r = 0; r < 8; r++) {
    const t = s % 61;
    const sr = rotl32((s + 0x9E3779B9) >>> 0, 7 + (7 & r));
    cells[t] = (sr ^ avalanche32(sr)) >>> 0;
    init[t] = 1;
    s = avalanche32((sr + t) >>> 0);
  }
  let word = avalanche32(0xA5A5A5A5 ^ s);
  const ks = new Uint8Array(length);
  let counter = 0, offset = 0;
  while (offset < length) {
    const d = word % 61;
    const inner = (cells[d] ^ imul(0x9E3779B9, counter + 1)) >>> 0;
    const mask = init[d] ? -1 : 0;
    const combined = ((word ^ inner) | (word & inner & mask)) >>> 0;
    const x = (rotl32((combined + word) >>> 0, 31 & d) ^ rotl32(word, 31 & ((d * 7) & 31))) >>> 0;
    word = avalanche32((x + 0x9E3779B9) >>> 0);
    cells[d] = word; init[d] = 1;
    ks[offset++] = word & 0xFF;
    if (offset < length) ks[offset++] = (word >>> 8) & 0xFF;
    if (offset < length) ks[offset++] = (word >>> 16) & 0xFF;
    if (offset < length) ks[offset++] = (word >>> 24) & 0xFF;
    counter++;
  }
  return ks;
}

function decryptPayload(encodedCiphertext, seed, tmdbId) {
  const bytes = decodeBase64Url(encodedCiphertext);
  if (bytes.length < 4) throw new Error("payload too short");
  const ks = generateKeystream(seed, tmdbId, bytes.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= ks[i];
  if (![0x6D, 0x76, 0x6D, 0x31].every((b, i) => bytes[i] === b)) throw new Error("bad seed or tampered payload");
  return new TextDecoder("utf-8").decode(bytes.subarray(4));
}

function parseHeight(rawQuality) {
  const match = /^(\d+)p?$/i.exec(String(rawQuality || "").trim());
  return match ? parseInt(match[1], 10) : 0;
}

function normalizeSubtitles(rawSubtitles) {
  return (rawSubtitles || [])
    .slice(0, 40)
    .map((s) => ({ language: `${s.label || s.lang || s.language || "Subtitle"}`, url: s.url || s.file }))
    .filter((s) => isHttpUrl(s.url));
}

function collectWantedSources(rawSources) {
  const seen = new Set();
  const out = [];
  for (const src of rawSources || []) {
    if (!src || !isHttpUrl(src.url) || seen.has(src.url)) continue;
    const h = parseHeight(src.quality);
    if (h !== 1080) continue; // 1080p LANG
    seen.add(src.url);
    out.push({ url: src.url, height: h, region: src.region || "MIAMI" });
  }
  return out;
}

function buildStreams(payload) {
  const subtitles = normalizeSubtitles(payload.subtitles);
  return collectWantedSources(payload.sources).map(({ url, height, region }) => {
    
    // Static seeds para magmukhang legit
    const fakeSeeds = 100; 
    
    // Eksaktong format: MIAMI | 1080P | 🌱 100
    const name = `${region} | ${height}P | 🌱 ${fakeSeeds}`;
    
    return {
      name,
      title: name,
      url,
      quality: `${height}p`,
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": BASE_URL
      },
      subtitles
    };
  });
}

async function fetchSeed(tmdbId) {
  const body = await fetchText(`${API_BASE}/seed?mediaId=${tmdbId}`);
  const { seed } = JSON.parse(body);
  if (!seed) throw new Error("empty_seed");
  return seed;
}

function buildSourcesUrl(region, mediaType, tmdbId, seed, season, episode) {
  let q = `mediaType=${mediaType}&tmdbId=${tmdbId}&enc=2&seed=${encodeURIComponent(seed)}&title=`;
  if (mediaType === "tv") q += `&seasonId=${season}&episodeId=${episode}`;
  return `${API_BASE}/${region}/sources?${q}`;
}

async function fetchPayloadFromRegion(region, mediaType, tmdbId, season, episode) {
  const seed = await fetchSeed(tmdbId);
  const url = buildSourcesUrl(region, mediaType, tmdbId, seed, season, episode);
  const encryptedBody = await fetchText(url);
  const payload = JSON.parse(decryptPayload(encryptedBody, seed, tmdbId));
  return payload.sources && payload.sources.length > 0 ? payload : null;
}

async function fetchPayload(mediaType, tmdbId, season, episode) {
  // Miami na lang ang gagamitin natin
  try {
    const payload = await fetchPayloadFromRegion("miami", mediaType, tmdbId, season, episode);
    if (payload) {
      // Lagyan natin ng region tag na "MIAMI"
      payload.sources = payload.sources.map(src => ({ ...src, region: "MIAMI" }));
      return payload;
    }
  } catch (_) { }
  
  return null;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const type = mediaType === "tv" ? "tv" : "movie";
    const id = Number(tmdbId);
    if (!id) return [];
    if (type === "tv" && (season == null || episode == null)) return [];
    const payload = await fetchPayload(type, id, Number(season), Number(episode));
    return payload ? buildStreams(payload) : [];
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
