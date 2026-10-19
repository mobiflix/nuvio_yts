const BASE_URL = "https://vidbolt.xyz";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const P_HEADERS = {
    "Referer": `${BASE_URL}/`,
    "User-Agent": USER_AGENT,
};
const HEADERS = { ...P_HEADERS, "Accept": "application/json" };

// Callisto na lang ang gagamitin
const SERVERS = ["callisto"];
const SERVER_LABELS = {
    callisto: "Callisto",
};

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

function parseSingleSource(payload) {
    const stream = payload && payload.stream;
    const rawSources = stream && Array.isArray(stream.sources) ? stream.sources : [];
    
    for (const source of rawSources) {
        if (!source || typeof source.url !== "string" || !source.url) continue;
        const quality = parseQuality(source.quality || source.name);
        if (!quality) continue;
        
        // Ibalik agad ang unang nahanap para isa lang
        return { 
            url: source.url, 
            quality, 
            serverName: stream && typeof stream.server === "string" ? stream.server : "" 
        };
    }
    return null;
}

async function locateSources(queryString) {
    // Dahil isa na lang ang server, diretso na tayo
    const payload = await fetchResolverPayload(`${queryString}&prefer=callisto`);
    const parsed = parseSingleSource(payload);
    
    if (parsed) {
        return [{
            url: parsed.url,
            quality: parsed.quality,
            serverName: parsed.serverName || "callisto"
        }];
    }
    
    return [];
}

async function getStreams(tmdbId, mediaType, season, episode) {
    if (!/^\d+$/.test(String(tmdbId))) return [];

    const isSeries = mediaType === "tv";
    if (!isSeries && mediaType !== "movie") return [];
    if (isSeries && (season == null || episode == null)) return [];

    const queryString = isSeries
        ? `type=tv&id=${tmdbId}&season=${season}&episode=${episode}`
        : `type=movie&id=${tmdbId}`;

    const availableSources = await locateSources(queryString);

    // I-mapa natin sila sa tamang format
    return availableSources.map((source) => {
        const displayServer = SERVER_LABELS[source.serverName.toLowerCase()] || source.serverName;
        
        // Format: Callisto | 1080P | 🌱 100
        const label = `${displayServer} | ${source.quality.label} | 🌱 100`;
        
        return {
            name: label,
            title: label,
            url: source.url,
            quality: source.quality.label,
            headers: P_HEADERS,
        };
    });
}

module.exports = { getStreams };
