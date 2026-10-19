const BASE_URL = "https://vidbolt.xyz";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const P_HEADERS = {
    "Referer": `${BASE_URL}/`,
    "User-Agent": USER_AGENT,
};
const HEADERS = { ...P_HEADERS, "Accept": "application/json" };

// Orion at Callisto lang
const SERVERS = ["orion", "callisto"];
const SERVER_LABELS = {
    orion: "Orion",
    callisto: "Callisto",
};

// Purong 1080P text para sa format
const Q_1080 = { label: "1080P" };

async function fetchResolverPayload(queryString) {
    try {
        const response = await fetch(`${BASE_URL}/api/resolve?${queryString}`, { headers: HEADERS });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

function parseQuality(rawQuality) {
    const normalized = String(rawQuality || "").trim().toLowerCase();
    if (/1080|fhd/.test(normalized)) return Q_1080;
    return null;
}

function parseSources(payload) {
    const stream = payload && payload.stream;
    const rawSources = stream && Array.isArray(stream.sources) ? stream.sources : [];
    const seenUrls = new Set();
    const candidates = [];

    for (const source of rawSources) {
        if (!source || typeof source.url !== "string" || !source.url || seenUrls.has(source.url)) continue;
        const quality = parseQuality(source.quality || source.name);
        if (!quality) continue;
        seenUrls.add(source.url);
        candidates.push({ url: source.url, quality });
    }

    return {
        candidates,
        serverName: stream && typeof stream.server === "string" ? stream.server : "",
    };
}

async function locateSources(queryString) {
    const fallbacks = await Promise.all(
        SERVERS.map(async (server) => {
            const parsed = parseSources(await fetchResolverPayload(`${queryString}&prefer=${server}`));
            return { candidates: parsed.candidates, serverName: parsed.serverName || server };
        })
    );

    return fallbacks.find((result) => result.candidates.length) || { candidates: [], serverName: "" };
}

async function getStreams(tmdbId, mediaType, season, episode) {
    if (!/^\d+$/.test(String(tmdbId))) return [];

    const isSeries = mediaType === "tv";
    if (!isSeries && mediaType !== "movie") return [];
    if (isSeries && (season == null || episode == null)) return [];

    const queryString = isSeries
        ? `type=tv&id=${tmdbId}&season=${season}&episode=${episode}`
        : `type=movie&id=${tmdbId}`;

    const { candidates, serverName } = await locateSources(queryString);
    
    // Siguraduhing tama ang capitalization
    const rawServer = serverName || (candidates.length > 0 ? "Orion" : "");
    const displayServer = SERVER_LABELS[rawServer.toLowerCase()] || rawServer;

    return candidates.slice(0, 3).map(({ url, quality }) => {
        // Format gaya ng screenshot: Orion | 1080P | 🌱 100
        const label = `${displayServer} | ${quality.label} | 🌱 100`;
        
        return {
            name: label,
            title: label,
            url,
            quality: quality.label, 
            headers: P_HEADERS,
        };
    });
}

module.exports = { getStreams };