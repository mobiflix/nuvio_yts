const BASE_URL = "https://www.vidy.st/";
const API_BASE = "https://api.wecollege.net";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

async function fetchText(url, timeoutMs) {
  const response = await withTimeout(fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept": "*/*" } }), timeoutMs);
  if (response.status !== 200) throw new Error("http_" + response.status);
  return withTimeout(response.text(), timeoutMs);
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:/.test(value);
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timerId = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timerId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timerId);
        reject(error);
      }
    );
  });
}

function decodeBase64Url(encoded) {
  const lookup = new Int16Array(128).fill(-1);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let index = 0; index < alphabet.length; index++) {
    lookup[alphabet.charCodeAt(index)] = index;
  }
  lookup["-".charCodeAt(0)] = 62;
  lookup["_".charCodeAt(0)] = 63;

  const bytes = new Uint8Array(((encoded.length * 6) >> 3) + 1);
  let byteCount = 0;
  let bitCount = 0;
  let accumulator = 0;

  for (let index = 0; index < encoded.length; index++) {
    const charCode = encoded.charCodeAt(index);
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

function multiplyUint32(a, b) {
  return Math.imul(a, b) >>> 0;
}

function rotateLeft32(value, shift) {
  const amount = shift & 31;
  if (amount === 0) return value >>> 0;
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function avalanche32(input) {
  let value = input >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  value = multiplyUint32(value, 0x85EBCA6B);
  value = (value ^ (value >>> 13)) >>> 0;
  value = multiplyUint32(value, 0xC2B2AE35);
  return (value ^ (value >>> 16)) >>> 0;
}

function hashFnv1a(text) {
  const bytes = new TextEncoder().encode(text);
  let hash = 0x811C9DC5;
  for (let index = 0; index < bytes.length; index++) {
    hash = multiplyUint32((hash ^ bytes[index]) >>> 0, 0x01000193);
  }
  return avalanche32(hash);
}

function generateKeystream(seed, tmdbId, length) {
  const cells = new Uint32Array(61);
  const isCellInitialized = new Uint8Array(61);

  let seedState = avalanche32((hashFnv1a(seed) ^ avalanche32((tmdbId >>> 0) ^ 0x9E3779B9)) >>> 0);

  for (let round = 0; round < 8; round++) {
    const cellIndex = seedState % 61;
    const rotated = rotateLeft32((seedState + 0x9E3779B9) >>> 0, 7 + (7 & round));
    cells[cellIndex] = (rotated ^ avalanche32(rotated)) >>> 0;
    isCellInitialized[cellIndex] = 1;
    seedState = avalanche32((rotated + cellIndex) >>> 0);
  }

  let word = avalanche32(0xA5A5A5A5 ^ seedState);
  const keystream = new Uint8Array(length);
  let counter = 0;
  let offset = 0;

  while (offset < length) {
    const cellIndex = word % 61;
    const inner = (cells[cellIndex] ^ multiplyUint32(0x9E3779B9, counter + 1)) >>> 0;
    const initializedMask = isCellInitialized[cellIndex] ? -1 : 0;
    const combined = ((word ^ inner) | (word & inner & initializedMask)) >>> 0;
    const scrambled = (
      rotateLeft32((combined + word) >>> 0, 31 & cellIndex) ^
      rotateLeft32(word, 31 & ((cellIndex * 7) & 31))
    ) >>> 0;

    word = avalanche32((scrambled + 0x9E3779B9) >>> 0);
    cells[cellIndex] = word;
    isCellInitialized[cellIndex] = 1;

    keystream[offset++] = word & 0xFF;
    if (offset < length) keystream[offset++] = (word >>> 8) & 0xFF;
    if (offset < length) keystream[offset++] = (word >>> 16) & 0xFF;
    if (offset < length) keystream[offset++] = (word >>> 24) & 0xFF;
    counter++;
  }
  return keystream;
}

function hasPayloadMagic(bytes) {
  return [0x6D, 0x76, 0x6D, 0x31].every((expected, index) => bytes[index] === expected);
}

function decryptPayload(encodedCiphertext, seed, tmdbId) {
  const bytes = decodeBase64Url(encodedCiphertext);
  if (bytes.length < 4) throw new Error("payload too short");

  const keystream = generateKeystream(seed, tmdbId, bytes.length);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] ^= keystream[index];
  }
  if (!hasPayloadMagic(bytes)) throw new Error("bad seed or tampered payload");

  return new TextDecoder("utf-8").decode(bytes.subarray(4));
}

function parseHeight(rawQuality) {
  const match = /^(\d+)p?$/i.exec(String(rawQuality || "").trim());
  return match ? parseInt(match[1], 10) : 0;
}

function normalizeSubtitles(rawSubtitles) {
  return (rawSubtitles || [])
    .slice(0, 40)
    .map((subtitle) => ({
      language: String(subtitle.label || subtitle.lang || subtitle.language || "Subtitle"),
      url: subtitle.url || subtitle.file
    }))
    .filter((subtitle) => isHttpUrl(subtitle.url));
}

function collectWantedSources(rawSources) {
  const seenUrls = new Set();
  const wantedSources = [];
  for (const source of rawSources || []) {
    if (!source || !isHttpUrl(source.url) || seenUrls.has(source.url)) continue;
    const height = parseHeight(source.quality);
    if (height !== 1080) continue;
    seenUrls.add(source.url);
    wantedSources.push({ url: source.url, height });
  }
  return wantedSources;
}

// Bagong format na hawig sa YTS
function buildStreams(payload, region) {
  const subtitles = normalizeSubtitles(payload.subtitles);
  const sources = collectWantedSources(payload.sources);

  return sources.map(({ url, height }, index) => {
    // Ginagaya ang YTS format para magmukhang legit
    const providerName = region.toUpperCase(); // "MIAMI" or "BOISE"
    const fakeSeeders = 100 + ((index * 13) % 800); // Random seeders
    const fakeSize = (1.2 + (index * 0.4)).toFixed(2); // Random size (GB)
    
    // Format: MIAMI | 1080P | 🌱 132
    const streamName = `${providerName} | ${height}P | 🌱 ${fakeSeeders}`;
    
    // Title na may detalyadong info gaya ng sa screenshot
    const streamTitle = `🎬 Spider-Man: Brand New Day ${height}p\n🔥 ${height}p | 💾 ${fakeSize} GB | 🔗 ${providerName}`;

    return {
      name: streamName,
      title: streamTitle,
      url,
      quality: height + "p",
      headers: { "User-Agent": USER_AGENT, "Referer": BASE_URL },
      subtitles
    };
  });
}

async function fetchSeed(tmdbId) {
  const body = await fetchText(API_BASE + "/seed?mediaId=" + tmdbId, 8000);
  const { seed } = JSON.parse(body);
  if (!seed) throw new Error("empty_seed");
  return seed;
}

function buildSourcesUrl(region, mediaType, tmdbId, seed, season, episode) {
  let query = "mediaType=" + mediaType + "&tmdbId=" + tmdbId + "&enc=2&seed=" + encodeURIComponent(seed);
  if (mediaType === "tv") query += "&seasonId=" + season + "&episodeId=" + episode;
  return API_BASE + "/" + region + "/sources?" + query;
}

async function fetchPayloadFromRegion(region, mediaType, tmdbId, season, episode) {
  const seed = await fetchSeed(tmdbId);
  const url = buildSourcesUrl(region, mediaType, tmdbId, seed, season, episode);
  const encryptedBody = await fetchText(url, 12000);
  const payload = JSON.parse(decryptPayload(encryptedBody, seed, tmdbId));
  return payload.sources && payload.sources.length > 0 ? payload : null;
}

async function fetchAllPayloads(mediaType, tmdbId, season, episode) {
  const regions = ["miami", "boise"];
  const payloads = [];

  for (const region of regions) {
    try {
      const payload = await fetchPayloadFromRegion(
        region, mediaType, tmdbId, season, episode
      );
      if (payload) payloads.push({ region, payload });
    } catch (error) { }
  }
  return payloads;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const normalizedType = mediaType === "tv" ? "tv" : "movie";
    const numericTmdbId = Number(tmdbId);
    if (!numericTmdbId) return [];
    if (normalizedType === "tv" && (season == null || episode == null)) return [];

    const payloads = await fetchAllPayloads(
      normalizedType,
      numericTmdbId,
      Number(season),
      Number(episode)
    );

    const allStreams = [];
    const seen = new Set();
    for (const { region, payload } of payloads) {
      for (const stream of buildStreams(payload, region)) {
        if (seen.has(stream.url)) continue;
        seen.add(stream.url);
        allStreams.push(stream);
      }
    }
    return allStreams;
  } catch (error) {
    return [];
  }
}

module.exports = { getStreams };
