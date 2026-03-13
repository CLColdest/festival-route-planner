import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")
const dataDir = path.join(rootDir, "data")

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET
const SPOTIFY_MARKET = process.env.SPOTIFY_MARKET || "CL"

if(!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET){
  console.error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET.")
  console.error("PowerShell example:")
  console.error('$env:SPOTIFY_CLIENT_ID="your_client_id"')
  console.error('$env:SPOTIFY_CLIENT_SECRET="your_client_secret"')
  console.error('node scripts/build-spotify-preview.mjs')
  process.exit(1)
}

function normalizeArtistName(name){
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function dedupeTracks(tracks){
  const seen = new Set()

  return tracks.filter(track => {
    const key = normalizeArtistName(track.name)

    if(seen.has(key)){
      return false
    }

    seen.add(key)
    return true
  })
}

async function readJson(filePath){
  return JSON.parse(await readFile(filePath, "utf8"))
}

async function getSpotifyAccessToken(){
  const body = new URLSearchParams({
    grant_type: "client_credentials"
  })
  const basicToken = Buffer
    .from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)
    .toString("base64")

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicToken}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  })

  if(!response.ok){
    throw new Error(`Spotify token request failed: ${response.status}`)
  }

  const payload = await response.json()
  return payload.access_token
}

async function spotifyApi(token, pathName, query = {}){
  const url = new URL(`https://api.spotify.com${pathName}`)

  Object.entries(query).forEach(([key, value]) => {
    if(value !== undefined && value !== null){
      url.searchParams.set(key, value)
    }
  })

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  })

  if(!response.ok){
    throw new Error(`Spotify API failed (${response.status}) for ${url}`)
  }

  return response.json()
}

async function getUniqueArtists(){
  const files = [
    path.join(dataDir, "friday.json"),
    path.join(dataDir, "saturday.json"),
    path.join(dataDir, "sunday.json")
  ]
  const artistMap = new Map()

  for(const filePath of files){
    const payload = await readJson(filePath)

    payload.shows.forEach(show => {
      if(!artistMap.has(show.artist)){
        artistMap.set(show.artist, {
          artist: show.artist,
          stage: show.stage
        })
      }
    })
  }

  return [...artistMap.values()]
}

async function loadOverrides(){
  const filePath = path.join(dataDir, "spotify-artist-overrides.json")

  try{
    return await readJson(filePath)
  }catch{
    return {}
  }
}

function chooseBestArtist(artistName, items, override){
  if(override?.spotifyArtistId){
    const overrideMatch = items.find(item => item.id === override.spotifyArtistId)

    if(overrideMatch){
      return {
        artist: overrideMatch,
        matchedBy: "override-id"
      }
    }
  }

  const normalizedArtist = normalizeArtistName(artistName)

  const exactMatch = items.find(item =>
    normalizeArtistName(item.name) === normalizedArtist
  )

  if(exactMatch){
    return {
      artist: exactMatch,
      matchedBy: "exact"
    }
  }

  const aliasMatch = items.find(item =>
    Array.isArray(override?.aliases) &&
    override.aliases.some(alias => normalizeArtistName(alias) === normalizeArtistName(item.name))
  )

  if(aliasMatch){
    return {
      artist: aliasMatch,
      matchedBy: "alias"
    }
  }

  const partialMatch = items.find(item =>
    normalizeArtistName(item.name).includes(normalizedArtist) ||
    normalizedArtist.includes(normalizeArtistName(item.name))
  )

  if(partialMatch){
    return {
      artist: partialMatch,
      matchedBy: "partial"
    }
  }

  if(items[0]){
    return {
      artist: items[0],
      matchedBy: "fallback"
    }
  }

  return null
}

async function searchArtist(token, artistQuery, override){
  const response = await spotifyApi(token, "/v1/search", {
    q: `artist:"${artistQuery}"`,
    type: "artist",
    limit: 5,
    market: SPOTIFY_MARKET
  })
  const bestArtist = chooseBestArtist(artistQuery, response.artists?.items || [], override)

  if(!bestArtist){
    return null
  }

  return {
    ...bestArtist.artist,
    matchedBy: bestArtist.matchedBy,
    matchedQuery: artistQuery,
    note: override?.note ?? null
  }
}

async function resolveArtists(token, artistName, override){
  if(Array.isArray(override?.spotifyArtistIds) && override.spotifyArtistIds.length > 0){
    const artists = await Promise.all(
      override.spotifyArtistIds.map(spotifyArtistId =>
        spotifyApi(token, `/v1/artists/${spotifyArtistId}`)
      )
    )

    return artists.map(artist => ({
      ...artist,
      matchedBy: "override-ids",
      matchedQuery: null,
      note: override.note ?? null
    }))
  }

  if(override?.spotifyArtistId){
    const artist = await spotifyApi(token, `/v1/artists/${override.spotifyArtistId}`)
    return [{
      ...artist,
      matchedBy: "override-id",
      matchedQuery: null,
      note: override.note ?? null
    }]
  }

  if(Array.isArray(override?.searchQueries) && override.searchQueries.length > 0){
    const artists = []

    for(const query of override.searchQueries){
      const artist = await searchArtist(token, query, override)

      if(artist){
        artists.push(artist)
      }
    }

    return artists
  }

  if(override?.searchQuery){
    const artist = await searchArtist(token, override.searchQuery, override)
    return artist ? [artist] : []
  }

  const artist = await searchArtist(token, artistName, override)
  return artist ? [artist] : []
}

async function resolveTracks(token, artists){
  const trackMap = new Map()

  for(const artist of artists){
    const response = await spotifyApi(token, "/v1/search", {
      q: `artist:"${artist.name}"`,
      type: "track",
      limit: 20,
      market: SPOTIFY_MARKET
    })
    const artistTracks = (response.tracks?.items || [])
      .filter(track =>
        track.artists?.some(trackArtist => trackArtist.id === artist.id)
      )

    artistTracks.forEach(track => {
      if(!trackMap.has(track.id)){
        trackMap.set(track.id, track)
      }
    })
  }

  const tracks = dedupeTracks(
    [...trackMap.values()].sort((a, b) => b.popularity - a.popularity)
  ).slice(0, 5)

  return tracks.map(track => ({
    id: track.id,
    name: track.name,
    url: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
    embedUrl: `https://open.spotify.com/embed/track/${track.id}`,
    popularity: track.popularity
  }))
}

async function buildPreviewEntry(token, artistName, override){
  if(override?.skip){
    return {
      skipped: true,
      note: override.note ?? "Preview omitido manualmente."
    }
  }

  const artists = await resolveArtists(token, artistName, override)

  if(!artists || artists.length === 0){
    return null
  }

  const tracks = await resolveTracks(token, artists)
  const firstTrack = tracks[0] || null
  const primaryArtist = artists[0]
  const artistIds = artists.map(artist => artist.id)
  const artistUrls = artists.map(artist => artist.external_urls?.spotify).filter(Boolean)
  const resolvedArtistNames = artists.map(artist => artist.name)
  const matchedBy = artists.map(artist => artist.matchedBy || "unknown")
  const matchedQueries = artists
    .map(artist => artist.matchedQuery)
    .filter(Boolean)

  return {
    artistId: primaryArtist.id,
    artistIds,
    artistName: override?.displayName ?? artistName,
    resolvedArtistNames,
    artistUrl: artistUrls[0] ?? `https://open.spotify.com/artist/${primaryArtist.id}`,
    embedUrl: firstTrack
      ? firstTrack.embedUrl
      : `https://open.spotify.com/embed/artist/${primaryArtist.id}`,
    note: override?.note ?? primaryArtist.note ?? "Top tracks por popularidad en Spotify Search.",
    tracks,
    diagnostics: {
      trackCount: tracks.length,
      matchedBy,
      matchedQueries
    }
  }
}

function evaluatePreviewQuality(preview){
  const reasons = []
  const matchedBy = preview.diagnostics?.matchedBy || []
  const trackCount = preview.diagnostics?.trackCount ?? preview.tracks.length

  if(trackCount === 0){
    reasons.push("No se encontraron tracks del artista resuelto.")
  }else if(trackCount === 1){
    reasons.push("Solo se encontro 1 track; el match puede ser incorrecto o incompleto.")
  }

  if(matchedBy.some(type => type === "fallback")){
    reasons.push("Se uso fallback al primer resultado de Spotify.")
  }

  if(matchedBy.some(type => type === "partial")){
    reasons.push("El match del artista fue parcial por nombre.")
  }

  return reasons
}

async function main(){
  const token = await getSpotifyAccessToken()
  const lineupArtists = await getUniqueArtists()
  const overrides = await loadOverrides()
  const artists = {}
  const unresolvedArtists = []
  const suspiciousArtists = []
  const skippedArtists = []

  console.log(`Building Spotify preview database for ${lineupArtists.length} artists...`)

  for(const entry of lineupArtists){
    const override = overrides[entry.artist] || null

    try{
      const preview = await buildPreviewEntry(token, entry.artist, override)

      if(!preview){
        unresolvedArtists.push(entry.artist)
        console.warn(`No Spotify match for ${entry.artist}`)
        continue
      }

      if(preview.skipped){
        skippedArtists.push({
          artist: entry.artist,
          reason: preview.note
        })
        console.log(`Skip ${entry.artist}: ${preview.note}`)
        continue
      }

      const reasons = evaluatePreviewQuality(preview)

      if(preview.tracks.length === 0){
        unresolvedArtists.push(entry.artist)
        console.warn(`No usable tracks for ${entry.artist}`)
        continue
      }

      artists[entry.artist] = preview
      console.log(`OK ${entry.artist} -> ${preview.artistName} (${preview.tracks.length} tracks)`)

      if(reasons.length > 0){
        suspiciousArtists.push({
          artist: entry.artist,
          resolvedArtistNames: preview.resolvedArtistNames,
          reasons
        })
        console.warn(`Review ${entry.artist}: ${reasons.join(" | ")}`)
      }
    }catch(error){
      unresolvedArtists.push(entry.artist)
      console.warn(`Failed ${entry.artist}: ${error.message}`)
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "spotify-search-build-script",
    market: SPOTIFY_MARKET,
    artists,
    unresolvedArtists,
    suspiciousArtists,
    skippedArtists
  }

  const outputPath = path.join(dataDir, "spotify-preview.json")

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")

  console.log(`\nWritten ${outputPath}`)
  console.log(`Resolved: ${Object.keys(artists).length}`)
  console.log(`Unresolved: ${unresolvedArtists.length}`)
  console.log(`Suspicious: ${suspiciousArtists.length}`)
  console.log(`Skipped: ${skippedArtists.length}`)

  if(unresolvedArtists.length > 0){
    console.log("Unresolved artists:")
    unresolvedArtists.forEach(name => console.log(`- ${name}`))
  }

  if(suspiciousArtists.length > 0){
    console.log("Suspicious artists:")
    suspiciousArtists.forEach(entry =>
      console.log(`- ${entry.artist}: ${entry.reasons.join(" | ")}`)
    )
  }

  if(skippedArtists.length > 0){
    console.log("Skipped artists:")
    skippedArtists.forEach(entry =>
      console.log(`- ${entry.artist}: ${entry.reason}`)
    )
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
