const API_BASE = "https://vidlink.pro/api/b";
const ENC_API = "https://enc-dec.app/api";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    "Connection": "keep-alive",
    "Referer": "https://vidlink.pro/",
    "Origin": "https://vidlink.pro",
};

// 1080p lang
const ALLOWED_QUALITIES = ["1080p"];

function qualityRank(quality) {
    const q = (quality || "").toUpperCase();
    if (q === "4K" || q === "2160P") return 5;
    if (q === "1440P") return 4;
    if (q === "1080P") return 3;
    if (q === "720P") return 2;
    if (q === "480P") return 1;
    return 0;
}

// Tag para sa sorting
function getSortTag(score, maxScore) {
    maxScore = maxScore || 999999;
    let inv = Math.max(0, maxScore - Math.max(0, parseInt(score, 10) || 0));
    let bin = inv.toString(2);
    while (bin.length < 20) bin = "0" + bin;
    return bin.split("").map(c => c === "1" ? "\uFEFF" : "\u200B").join("");
}

async function encryptTmdbId(tmdbId) {
    try {
        const res = await fetch(`${ENC_API}/enc-vidlink?text=${tmdbId}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data?.result ?? null;
    } catch {
        return null;
    }
}

function extractQuality(str) {
    if (!str) return null;
    const s = str.toString().toLowerCase();
    if (s.includes("2160") || s.includes("4k")) return "4K";
    if (s.includes("1440") || s.includes("2k")) return "1440p";
    if (s.includes("1080") || s.includes("fhd")) return "1080p";
    if (s.includes("720") || s.includes("hd")) return "720p";
    const match = s.match(/(\d{3,4})[p]?/);
    if (match) {
        const h = parseInt(match[1]);
        if (h >= 2160) return "4K";
        if (h >= 1440) return "1440p";
        if (h >= 1080) return "1080p";
        if (h >= 720) return "720p";
    }
    return null;
}

function resolveUrl(url, baseUrl) {
    if (!url) return null;
    if (url.startsWith("http")) return url;
    try {
        return new URL(url, baseUrl).toString();
    } catch {
        return url;
    }
}

// Kukunin ang pangalan ng server base sa URL kung walang binigay ang API
function getServerName(url, originalName) {
    if (originalName && typeof originalName === 'string' && originalName.trim() !== '' && originalName.toLowerCase() !== 'vidlink') {
        return originalName.toUpperCase();
    }
    
    try {
        const hostname = new URL(url).hostname;
        const parts = hostname.split('.');
        // Kunin ang pinaka-unang part (e.g., "miami" mula sa "miami.cdn.com")
        let name = parts[0];
        if (name === 'www' || name === 'cdn' || name === 'api') {
            name = parts[1] || 'VIDLINK';
        }
        return name.toUpperCase();
    } catch {
        return "VIDLINK";
    }
}

function buildStream(url, qualityKey, serverName) {
    if (!url) return null;
    const quality = extractQuality(qualityKey);
    // 1080p lang ang tatanggapin
    if (quality !== "1080p") return null;
    
    // Fallback sa VIDLINK kung walang ma-extract na pangalan
    const finalServerName = serverName || "VIDLINK";

    return {
        name: finalServerName, // Gagamitin ito ng UI mo sa unahan
        title: finalServerName,
        url,
        quality,
        type: url.toLowerCase().includes(".m3u8") ? "m3u8" : "video",
    };
}

function parseM3U8(content, baseUrl) {
    const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
    const streams = [];
    let current = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
            current = { resolution: null, name: null };
            const resMatch = line.match(/RESOLUTION=(\d+x\d+)/);
            if (resMatch) current.resolution = resMatch[1];
            
            // Minsan may NAME o SERVER attribute ang playlist
            const nameMatch = line.match(/(?:NAME|SERVER)="([^"]+)"/i);
            if (nameMatch) current.name = nameMatch[1];
        } else if (current && !line.startsWith("#")) {
            current.url = resolveUrl(line, baseUrl);
            streams.push(current);
            current = null;
        }
    }
    return streams;
}

async function fetchM3U8Streams(playlistUrl) {
    try {
        const r = await fetch(playlistUrl, { headers: HEADERS });
        if (!r.ok) return [];
        const content = await r.text();
        if (!content) return [];
        return parseM3U8(content, playlistUrl).map(s => {
            const qualityKey = s.resolution ? s.resolution.split("x").pop() + "p" : null;
            const serverName = getServerName(s.url, s.name);
            return buildStream(s.url, qualityKey, serverName);
        }).filter(Boolean);
    } catch {
        return [];
    }
}

function extractStreamsFromData(data) {
    const results = [];
    if (!data) return results;

    if (data.stream && data.stream.qualities) {
        for (const key of Object.keys(data.stream.qualities)) {
            const item = data.stream.qualities[key];
            if (item && item.url) {
                const serverName = getServerName(item.url, item.server || item.name || item.source);
                const s = buildStream(item.url, key, serverName);
                if (s) results.push(s);
            }
        }
        if (data.stream.playlist) {
            results.push({ _playlist: true, url: data.stream.playlist });
        }
        return results;
    }

    if (data.stream && data.stream.playlist) {
        results.push({ _playlist: true, url: data.stream.playlist });
        return results;
    }

    if (data.url) {
        const serverName = getServerName(data.url, data.server || data.name || data.source);
        const s = buildStream(data.url, data.quality || null, serverName);
        if (s) results.push(s);
        return results;
    }

    if (Array.isArray(data.streams)) {
        for (const item of data.streams) {
            if (item && item.url) {
                const serverName = getServerName(item.url, item.server || item.name || item.source);
                const s = buildStream(item.url, item.quality || item.resolution || null, serverName);
                if (s) results.push(s);
            }
        }
        return results;
    }

    if (Array.isArray(data.links)) {
        for (const item of data.links) {
            if (item && item.url) {
                const serverName = getServerName(item.url, item.server || item.name || item.source);
                const s = buildStream(item.url, item.quality || null, serverName);
                if (s) results.push(s);
            }
        }
        return results;
    }

    (function findUrls(obj) {
        if (!obj || typeof obj !== "object") return;
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            const keyLower = key.toLowerCase();
            if (keyLower.includes("subtitle") || keyLower.includes("caption")) continue;
            if (typeof val === "string" && val.startsWith("http")) {
                if (val.includes(".srt") || val.includes(".vtt") ||
                    val.includes("subtitle") || val.includes("caption")) continue;
                const serverName = getServerName(val, obj.name || obj.server || obj.source);
                const s = buildStream(val, key, serverName);
                if (s) results.push(s);
            } else if (typeof val === "object" && val !== null) {
                findUrls(val);
            }
        }
    })(data);

    return results;
}

// Dito natin papalitan ang format ng output
function sortAndDedupeStreams(streams) {
    const seen = new Set();
    let result = streams
        .filter(s => ALLOWED_QUALITIES.includes(s.quality) && s.url && s.url.startsWith("https"))
        .filter(s => !seen.has(s.url) && seen.add(s.url));

    result.sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));

    const total = result.length;
    return result.map((s, i) => {
        // Gagawa tayo ng format: SERVER_NAME | 1080P | 🌱 100
        // Pwede mong palitan ang "🌱 100" base sa rating system mo kung meron
        const displayName = `${s.name} | 1080P | 🌱 100`;
        
        // Para sa sorting mechanism mo sa UI
        const tag = getSortTag(total - i, total + 1); 
        
        return Object.assign({}, s, { 
            name: tag + displayName, 
            title: tag + displayName 
        });
    });
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (mediaType === "tv" && (season == null || episode == null)) return [];

        const encryptedId = await encryptTmdbId(tmdbId);
        if (!encryptedId) return [];

        const vidlinkUrl = mediaType === "tv"
            ? `${API_BASE}/tv/${encryptedId}/${season}/${episode}`
            : `${API_BASE}/movie/${encryptedId}`;

        const r = await fetch(vidlinkUrl, { headers: HEADERS });
        if (!r.ok) return [];
        const data = await r.json();
        if (!data) return [];

        const extracted = extractStreamsFromData(data);
        if (!extracted.length) return [];

        const playlists = extracted.filter(x => x._playlist);
        const direct = extracted.filter(x => !x._playlist);

        if (!playlists.length) return sortAndDedupeStreams(direct);

        const m3u8Results = await Promise.all(playlists.map(p => fetchM3U8Streams(p.url)));
        return sortAndDedupeStreams(direct.concat(...m3u8Results));
    } catch {
        return [];
    }
}

module.exports = { getStreams };