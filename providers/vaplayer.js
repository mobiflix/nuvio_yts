const TMDB_API = "https://api.themoviedb.org/3";
const API_BASE = "https://streamdata.vaplayer.ru";
const REFERER = "https://nextgencloudfabric.com/";
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    "Referer": REFERER,
    "Origin": REFERER,
};

// Detect quality from URL (e.g. 480p, 720p, 1080p, 2160p, 4k)
function detectQuality(url) {
    if (!url) return { label: "unknown", rank: 0 };
    const lower = url.toLowerCase();

    if (/(2160p|4k|uhd)/.test(lower)) return { label: "2160p", rank: 4 };
    if (/1080p/.test(lower))             return { label: "1080p", rank: 3 };
    if (/720p/.test(lower))              return { label: "720p",  rank: 2 };
    if (/(480p|sd)/.test(lower))         return { label: "480p",  rank: 1 };

    const m = lower.match(/(\d{3,4})p/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 2160) return { label: "2160p", rank: 4 };
        if (n >= 1080) return { label: "1080p", rank: 3 };
        if (n >= 720)  return { label: "720p",  rank: 2 };
        if (n >= 480)  return { label: "480p",  rank: 1 };
    }
    return { label: "unknown", rank: 0 };
}

async function fetchImdbId(tmdbId, mediaType) {
    try {
        const endpoint = mediaType === "tv" ? "tv" : "movie";
        const url = `${TMDB_API}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
        const res = await fetch(url, { headers: { "User-Agent": HEADERS["User-Agent"], "Accept": "application/json" } });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.external_ids?.imdb_id || null;
    } catch {
        return null;
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (mediaType === "tv" && (season == null || episode == null)) return [];

        const imdbId = await fetchImdbId(tmdbId, mediaType);
        if (!imdbId) return [];

        const url = (season != null && episode != null)
            ? `${API_BASE}/api.php?imdb=${imdbId}&type=tv&season=${season}&episode=${episode}`
            : `${API_BASE}/api.php?imdb=${imdbId}&type=movie`;

        const res = await fetch(url, { headers: { ...HEADERS, "Accept": "application/json" } });
        if (!res.ok) return [];

        const data = await res.json();
        if (!data || data.status_code === "error" || !data.data) return [];

        let rawItems = [];
        if (Array.isArray(data.data.stream_urls)) {
            rawItems = data.data.stream_urls;
        } else if (typeof data.data.stream_urls === "object" && data.data.stream_urls !== null) {
            rawItems = Object.values(data.data.stream_urls);
        } else if (data.data.stream_url) {
            rawItems = [data.data.stream_url];
        }

        const streamMap = new Map();

        for (const item of rawItems) {
            let streamUrl = "";

            if (typeof item === "string") {
                streamUrl = item;
            } else if (item && typeof item === "object") {
                streamUrl = item.url || item.file || item.src || "";
            } else {
                continue;
            }

            if (!streamUrl) continue;

            const cleanUrl = streamUrl.trim().replace(/\/+$/, "");
            if (!streamMap.has(cleanUrl)) {
                streamMap.set(cleanUrl, cleanUrl);
            }
        }

        if (streamMap.size === 0) return [];

        // Pick the single highest-quality stream
        let best = null;
        for (const streamUrl of streamMap.values()) {
            const q = detectQuality(streamUrl);
            if (!best || q.rank > best.rank) {
                best = { url: streamUrl, ...q };
            }
        }

        if (!best) return [];

        const subs = data.data.default_subs || data.default_subs || [];
        const subtitles = (Array.isArray(subs) ? subs : [])
            .filter(s => s.url)
            .map(s => ({
                url: s.url,
                language: s.code || s.lang || "unknown",
                name: s.lang || s.code || "Unknown",
            }));

        return [{
            name: "VAplayer",
            title: "VAplayer",
            url: best.url,
            quality: best.label,
            headers: HEADERS,
            subtitles,
        }];
    } catch {
        return [];
    }
}

module.exports = { getStreams };