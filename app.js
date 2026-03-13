let walkingTime = 3
let shows = []
let selectedShows = []
let stageOrder = []
let routeGenerated = false
let lastCalculatedRoute = []
let routeHasCalculatedOnce = false
let previousSearchLength = 0
let lastScrolledShowId = null
let routeMode = "strict" 
let themeMode = "light"
let armedRemoveShowKey = null
const walkingTimeSelector = document.getElementById("walkingTimeSelector")
const routeResult = document.getElementById("routeResult")
const daySelector = document.getElementById("daySelector")
const artistSearch = document.getElementById("artistSearch")
const artistPreviewPanel = document.getElementById("artistPreviewPanel")
const artistPreviewTitle = document.getElementById("artistPreviewTitle")
const artistPreviewMeta = document.getElementById("artistPreviewMeta")
const artistPreviewBody = document.getElementById("artistPreviewBody")
const artistPreviewPlayer = document.getElementById("artistPreviewPlayer")
const artistPreviewPlayerStatus = document.getElementById("artistPreviewPlayerStatus")
const artistPreviewPlayerFrameWrap = document.getElementById("artistPreviewPlayerFrameWrap")
const artistPreviewBrowse = document.getElementById("artistPreviewBrowse")
const artistPreviewPlaybackArchive = document.getElementById("artistPreviewPlaybackArchive")
const artistPreviewClose = document.getElementById("artistPreviewClose")
const MIN_VISIBLE_MINUTES = 10
const MIN_SPLIT = 15
const MAX_ARCHIVED_PREVIEW_FRAMES = 8
const THEME_STORAGE_KEY = "festival-route-theme"
const ROUTE_DEBUG = true
const TESTING_CONFIG = {
enabled: false,
day: "saturday",
routeMode: "strict",
walkingTime: 3,
scenario: "conflict-heavy",
seed: 20260312,
selectionCount: 9,
minStartHour: 17,
autoCalculate: true,
autoGenerateOnLoad: false,
showToast: true
}
const SPOTIFY_PREVIEW_DATA_URL = "data/spotify-preview.json"
let spotifyPreviewDatabase = null
let activePreviewArtist = null
let activePreviewShowKey = null
let activePreviewData = null
let activePreviewTrackIndex = 0
let currentPreviewRequestId = 0

function debugLog(...args){

if(!ROUTE_DEBUG) return

console.log(...args)

}

function debugGroup(label){

if(!ROUTE_DEBUG) return

console.group(label)

}

function debugGroupEnd(){

if(!ROUTE_DEBUG) return

console.groupEnd()

}

function createSeededRandom(seed){

let state = seed >>> 0

return ()=>{

state += 0x6D2B79F5

let value = Math.imul(state ^ (state >>> 15), 1 | state)
value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)

return ((value ^ (value >>> 14)) >>> 0) / 4294967296

}

}

function formatMinutes(totalMinutes){

const normalized = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60)
const hours = Math.floor(normalized / 60)
const minutes = normalized % 60

return `${hours.toString().padStart(2,"0")}:${minutes.toString().padStart(2,"0")}`

}

function randomChoice(items,rng){

if(items.length === 0){
return null
}

const index = Math.floor(rng() * items.length)

return items[index]

}

function weightedPick(items,weights,rng){

const totalWeight = weights.reduce((sum,weight)=>sum + weight,0)

if(totalWeight <= 0){
return randomChoice(items,rng)
}

let threshold = rng() * totalWeight

for(let i=0;i<items.length;i++){

threshold -= weights[i]

if(threshold <= 0){
return items[i]
}

}

return items[items.length - 1]

}

function describeShow(show){

if(!show){
return "(sin show)"
}

return `${show.artist} [${show.stage}] ${show.start}-${show.end} ${"⭐".repeat(getPriority(show)) || "sin prioridad"}`

}

function isSameShow(showA,showB){

return (
showA.artist === showB.artist &&
showA.start === showB.start &&
showA.stage === showB.stage
)

}

function getShowKey(show){

return `${show.artist}__${show.start}__${show.stage}`

}

function findSelectedShowIndex(show){

return selectedShows.findIndex(selectedShow => isSameShow(selectedShow,show))

}

function isShowSelected(show){

return findSelectedShowIndex(show) !== -1

}

function getShowFromElement(element){

const id = Number(element.dataset.id)

return shows.find(show => show.id === id) || null

}

function getShowElement(show){

return document.querySelector(`.show[data-id="${show.id}"]`)

}

function normalizeArtistName(name){

return name
.normalize("NFD")
.replace(/[\u0300-\u036f]/g,"")
.toLowerCase()
.replace(/[^a-z0-9]+/g," ")
.trim()

}

async function loadSpotifyPreviewDatabase(){

if(spotifyPreviewDatabase){
return spotifyPreviewDatabase
}

try{
const response = await fetch(SPOTIFY_PREVIEW_DATA_URL, {
cache: "no-cache"
})

if(!response.ok){
throw new Error(`spotify-preview-db-${response.status}`)
}

const payload = await response.json()

spotifyPreviewDatabase = payload

debugLog("[PREVIEW] database loaded", {
artists: Object.keys(payload.artists || {}).length,
generatedAt: payload.generatedAt ?? null
})

return spotifyPreviewDatabase

}catch(error){

console.error("Spotify preview database error", error)
spotifyPreviewDatabase = {
generatedAt: null,
artists: {}
}

return spotifyPreviewDatabase

}

}

function getStaticSpotifyPreview(show){

const database = spotifyPreviewDatabase?.artists || {}
const exactMatch = database[show.artist]

if(exactMatch){
return exactMatch
}

const normalizedArtist = normalizeArtistName(show.artist)

const matchedKey = Object.keys(database).find(key =>
normalizeArtistName(key) === normalizedArtist
)

return matchedKey ? database[matchedKey] : null

}

function renderArtistPreviewLoading(show){

if(artistPreviewPlayerStatus){
artistPreviewPlayerStatus.innerHTML = ""
}

artistPreviewBrowse.innerHTML = `
<div class="artistPreviewEmpty">
<strong>Cargando preview...</strong>
<span>Buscando temas guardados para ${show.artist}.</span>
</div>
`

}

function renderArtistPreviewUnavailable(show,note){

activePreviewData = null
activePreviewTrackIndex = 0
activePreviewShowKey = getShowKey(show)
archiveVisiblePreviewFrame()

if(artistPreviewPlayerStatus){
artistPreviewPlayerStatus.innerHTML = ""
}

if(artistPreviewPlayerFrameWrap){
artistPreviewPlayerFrameWrap.innerHTML = `
<div class="artistPreviewEmpty artistPreviewEmptyCompact">
<strong>Sin reproductor para este artista.</strong>
</div>
`
}

artistPreviewBrowse.innerHTML = `
<div class="artistPreviewEmpty">
<strong>Sin preview disponible.</strong>
<span>${note ?? `Aun no hay datos guardados para ${show.artist}.`}</span>
</div>
`

}

function getPreviewEmbedUrl(data, trackIndex){

const selectedTrack = Array.isArray(data.tracks)
? data.tracks[trackIndex]
: null

return selectedTrack?.embedUrl || data.embedUrl

}

function createPreviewFrameMarkup(embedUrl){

return `
<iframe
class="artistPreviewFrame"
src="${embedUrl}"
data-embed-url="${embedUrl}"
width="100%"
height="232"
frameborder="0"
allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
loading="lazy">
</iframe>
`

}

function pruneArchivedPreviewFrames(){

if(!artistPreviewPlaybackArchive) return

while(artistPreviewPlaybackArchive.children.length > MAX_ARCHIVED_PREVIEW_FRAMES){
artistPreviewPlaybackArchive.firstElementChild?.remove()
}

}

function archiveVisiblePreviewFrame(){

if(!artistPreviewPlayerFrameWrap || !artistPreviewPlaybackArchive) return

const currentFrame = artistPreviewPlayerFrameWrap.querySelector(".artistPreviewFrame")

if(!currentFrame){
return
}

const archivedFrame = document.createElement("div")
archivedFrame.className = "artistPreviewArchivedFrame"
archivedFrame.dataset.embedUrl = currentFrame.dataset.embedUrl || ""
archivedFrame.appendChild(currentFrame)

artistPreviewPlaybackArchive.appendChild(archivedFrame)
pruneArchivedPreviewFrames()

}

function setVisiblePreviewFrame(data,trackIndex,{ preserveCurrent = false } = {}){

if(!artistPreviewPlayerFrameWrap) return

const nextEmbedUrl = getPreviewEmbedUrl(data, trackIndex)
const currentFrame = artistPreviewPlayerFrameWrap.querySelector(".artistPreviewFrame")
const currentEmbedUrl = currentFrame?.dataset.embedUrl || null

if(currentEmbedUrl === nextEmbedUrl){
activePreviewTrackIndex = trackIndex
return
}

if(preserveCurrent){
archiveVisiblePreviewFrame()
}

artistPreviewPlayerFrameWrap.innerHTML = createPreviewFrameMarkup(nextEmbedUrl)
activePreviewTrackIndex = trackIndex

}

function renderArtistPreviewContent(data,{ preserveCurrentFrame = false, trackIndex = 0 } = {}){

if(!artistPreviewBrowse || !artistPreviewPlayerFrameWrap) return

activePreviewData = data

if(artistPreviewPlayerStatus){
artistPreviewPlayerStatus.innerHTML = ""
}

setVisiblePreviewFrame(data, trackIndex, {
preserveCurrent: preserveCurrentFrame
})

const tracksMarkup = Array.isArray(data.tracks) && data.tracks.length > 0
? `
<div class="artistPreviewTrackList">
${data.tracks.map((track,index)=>`
<button
type="button"
class="artistPreviewTrack${index === activePreviewTrackIndex ? " active" : ""}"
data-track-index="${index}"
aria-pressed="${index === activePreviewTrackIndex ? "true" : "false"}"
title="Cargar ${track.name} en el reproductor">
<span>${index + 1}. ${track.name}</span>
</button>
`).join("")}
</div>
`
: ""

artistPreviewBrowse.innerHTML = `
<div class="artistPreviewNote">${data.note ?? "Top tracks guardados desde Spotify."}</div>
${tracksMarkup}
`

}

function loadPreviewTrack(data, trackIndex){

if(!data){
return
}

renderArtistPreviewContent(data,{
preserveCurrentFrame: true,
trackIndex
})

}

function hideArtistPreview(){
activePreviewArtist = null
activePreviewShowKey = null
activePreviewData = null
activePreviewTrackIndex = 0
currentPreviewRequestId += 1

if(!artistPreviewPanel) return

artistPreviewPanel.hidden = true

}

async function showArtistPreview(show){

if(!artistPreviewPanel) return

const previewShowKey = getShowKey(show)

if(activePreviewShowKey === previewShowKey && !artistPreviewPanel.hidden){
return
}

const requestId = ++currentPreviewRequestId

activePreviewArtist = show.artist
activePreviewShowKey = previewShowKey
artistPreviewPanel.hidden = false
artistPreviewTitle.innerText = show.artist
artistPreviewMeta.innerText = `${show.stage} · ${show.start}-${show.end}`

renderArtistPreviewLoading(show)

const database = await loadSpotifyPreviewDatabase()

if(requestId !== currentPreviewRequestId){
return
}

const preview = getStaticSpotifyPreview(show)

if(!preview){
renderArtistPreviewUnavailable(
show,
database.generatedAt
? "No hay preview en el JSON generado para este artista."
: "Todavia no existe `data/spotify-preview.json` o no se pudo cargar."
)
return
}

renderArtistPreviewContent(preview,{
preserveCurrentFrame: true,
trackIndex: 0
})

debugLog("[PREVIEW] open", {
artist: show.artist,
spotifyUrl: preview.artistUrl || null,
tracks: (preview.tracks || []).map(track => track.name)
})

}

function debugSelectionState(source,show,extra = {}){

debugLog(`[SELECT] ${source}`, {
show: describeShow(show),
selectedCount: selectedShows.length,
selectedShows: selectedShows.map(describeShow),
...extra
})

}

function updateShowCardControls(show,element){

if(!element) return

const selected = isShowSelected(show)
const isArmed = routeGenerated && selected && armedRemoveShowKey === getShowKey(show)
const removeButton = element.querySelector(".show-remove-btn")

element.classList.toggle("selected", selected)
element.classList.toggle("show-remove-armed", isArmed)

if(removeButton){
removeButton.hidden = !isArmed
}

}

function syncAllShowCardControls(){

const allShows = document.querySelectorAll(".show")

allShows.forEach(element=>{

const show = getShowFromElement(element)

if(show){
updateShowCardControls(show,element)
}

})

}

function setArmedRemoveShow(show){

armedRemoveShowKey = show ? getShowKey(show) : null
syncAllShowCardControls()

}

function invalidateCalculatedRoute(reason,{ preserveRecalculateLabel = routeHasCalculatedOnce } = {}){

if(!routeGenerated && lastCalculatedRoute.length === 0){
if(!preserveRecalculateLabel){
routeHasCalculatedOnce = false
updateRouteButtonText()
}
setArmedRemoveShow(null)
return
}

debugLog("[ROUTE] invalidate", {
reason,
selectedShows: selectedShows.map(describeShow)
})

routeGenerated = false
lastCalculatedRoute = []

if(!preserveRecalculateLabel){
routeHasCalculatedOnce = false
}

armedRemoveShowKey = null
routeResult.innerHTML = ""

const allShows = document.querySelectorAll(".show")

allShows.forEach(element=>{
element.classList.remove("route")
element.classList.remove("rejected")
element.classList.remove("show-remove-armed")
})

syncAllShowCardControls()
checkConflicts()
updateRouteButtonText()

}

function rehydrateLineupState(){

syncAllShowCardControls()
checkConflicts()

if(routeGenerated && lastCalculatedRoute.length > 0){
markRouteOnGrid(lastCalculatedRoute)
}

}

function getOverlapCount(show,pool){

return pool.filter(other => other !== show && hasConflict(show,other)).length

}

function getTestingCandidatePool(config){

const minStartMinutes = (config.minStartHour ?? 0) * 60
const lateShows = shows.filter(show => timeToMinutes(show.start) >= minStartMinutes)
const basePool = lateShows.length > 0 ? lateShows : shows

if(config.scenario === "full-day"){
return [...shows]
}

if(config.scenario === "late-night"){
const nightPool = shows.filter(show => timeToMinutes(show.start) >= 19 * 60)
return nightPool.length > 0 ? nightPool : basePool
}

const conflictPool = basePool.filter(show => getOverlapCount(show,basePool) > 0)

if(config.scenario === "conflict-heavy"){
return conflictPool.length > 0 ? conflictPool : basePool
}

return basePool

}

function getTestingPriority(rng){

const roll = rng()

if(roll < 0.45){
return 1
}

if(roll < 0.8){
return 2
}

return 3

}

function buildTestingSelection(config){

const rng = createSeededRandom(config.seed)
const pool = getTestingCandidatePool(config)
const overlapMap = new Map(
pool.map(show => [show.id, getOverlapCount(show,pool)])
)
const targetCount = Math.max(
1,
Math.min(config.selectionCount ?? 8, pool.length)
)
const available = [...pool]
const picked = []

while(picked.length < targetCount && available.length > 0){

const weights = available.map(show=>{
const overlapWeight = 1 + (overlapMap.get(show.id) || 0) * 2
const lateBonus = timeToMinutes(show.start) >= 18 * 60 ? 1.5 : 0

return overlapWeight + lateBonus
})
const chosen = weightedPick(available,weights,rng)

if(!chosen){
break
}

picked.push(chosen)

const chosenIndex = available.findIndex(show => show.id === chosen.id)

if(chosenIndex !== -1){
available.splice(chosenIndex,1)
}

}

const selection = picked.map(show=>({
id: show.id,
priority: getTestingPriority(rng)
}))

const bestConflictCandidate = picked
.slice()
.sort((a,b)=>(overlapMap.get(b.id) || 0) - (overlapMap.get(a.id) || 0))[0]

if(bestConflictCandidate){
const item = selection.find(entry => entry.id === bestConflictCandidate.id)

if(item){
item.priority = 3
}
}

return selection

}

function applyTestingSelection(selection){

selectedShows = []
lastCalculatedRoute = []
routeGenerated = false
routeHasCalculatedOnce = false
armedRemoveShowKey = null
routeResult.innerHTML = ""

shows.forEach(show=>{
show.priority = 0
})

selection.forEach(item=>{

const show = shows.find(entry => entry.id === item.id)

if(!show) return

show.priority = item.priority
selectedShows.push(show)

})

renderLineup()
updateMobileRouteButton()
updateRouteButtonText()

debugLog("[TEST] applied selection", selectedShows.map(describeShow))

}

function setRouteMode(mode,{ announce = true } = {}){

const modeSwitch = document.getElementById("routeModeSwitch")
const strictModeLabel = document.getElementById("strictModeLabel")
const flexibleModeLabel = document.getElementById("flexibleModeLabel")
const previousMode = routeMode

routeMode = mode === "flexible"
? "flexible"
: "strict"

if(modeSwitch){
modeSwitch.classList.toggle("active", routeMode === "flexible")
modeSwitch.setAttribute("aria-checked", routeMode === "flexible" ? "true" : "false")
modeSwitch.setAttribute("aria-label", routeMode === "flexible" ? "Modo flexible" : "Modo estricto")
}

if(strictModeLabel){
strictModeLabel.classList.toggle("active", routeMode === "strict")
}

if(flexibleModeLabel){
flexibleModeLabel.classList.toggle("active", routeMode === "flexible")
}

if(announce){
showModeToast(routeMode)
}

if(previousMode !== routeMode && routeGenerated){
invalidateCalculatedRoute("mode change", {
preserveRecalculateLabel: true
})
}

}

function getInitialThemeMode(){

if(window.__initialThemeMode === "light" || window.__initialThemeMode === "dark"){
return window.__initialThemeMode
}

try{
const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)

if(storedTheme === "light" || storedTheme === "dark"){
return storedTheme
}
}catch(error){
console.warn("Theme storage unavailable", error)
}

return "dark"

}

function setThemeMode(mode,{ announce = true, persist = true } = {}){

const themeSwitch = document.getElementById("themeSwitch")
const lightThemeLabel = document.getElementById("lightThemeLabel")
const darkThemeLabel = document.getElementById("darkThemeLabel")

themeMode = mode === "dark"
? "dark"
: "light"

document.body.classList.toggle("theme-dark", themeMode === "dark")

if(themeSwitch){
themeSwitch.classList.toggle("active", themeMode === "dark")
themeSwitch.setAttribute("aria-checked", themeMode === "dark" ? "true" : "false")
themeSwitch.setAttribute("aria-label", themeMode === "dark" ? "Tema oscuro" : "Tema claro")
}

if(lightThemeLabel){
lightThemeLabel.classList.toggle("active", themeMode === "light")
}

if(darkThemeLabel){
darkThemeLabel.classList.toggle("active", themeMode === "dark")
}

if(persist){
try{
localStorage.setItem(THEME_STORAGE_KEY, themeMode)
}catch(error){
console.warn("Theme storage unavailable", error)
}
}

if(announce){
showToast(themeMode === "dark" ? "Tema oscuro activado." : "Tema claro activado.")
}

}

async function runTestingScenario(overrides = {}){

const config = {
...TESTING_CONFIG,
...overrides
}
const targetDay = config.day || daySelector.value

if(config.loadDay !== false && (shows.length === 0 || daySelector.value !== targetDay)){
daySelector.value = targetDay
await loadDay(targetDay)
}

walkingTime = Number(config.walkingTime ?? walkingTime)
walkingTimeSelector.value = String(walkingTime)

setRouteMode(config.routeMode ?? "strict", {
announce: false,
recalculate: false
})

const selection = buildTestingSelection(config)

applyTestingSelection(selection)

if(config.autoCalculate){
calculateRoute()
}

if(config.showToast){
showToast(`Testing ${config.scenario} · ${selection.length} shows · seed ${config.seed}`)
}

return selection

}

function logTestingRunSummary(config,selection){

debugGroup(`[TEST] random seed ${config.seed}`)
debugLog("[TEST] config", config)
debugLog("[TEST] selected schedule", selection
.map(item=>{

const show = shows.find(entry => entry.id === item.id)

if(!show){
return null
}

return {
artist: show.artist,
stage: show.stage,
time: `${show.start}-${show.end}`,
priority: `${"⭐".repeat(item.priority)}`
}

})
.filter(Boolean))

if(lastCalculatedRoute.length > 0){
debugLog("[TEST] route snapshot", lastCalculatedRoute.map(show=>({
artist: show.artist,
stage: show.stage,
time: `${formatMinutes(show.startReal)}-${formatMinutes(show.endReal)}`
})))
}

debugGroupEnd()

}

function buildRandomTestingConfig(){

const seed = Math.floor(Math.random() * 1000000000)
const rng = createSeededRandom(seed)
const scenario = randomChoice(
["conflict-heavy","late-night","full-day"],
rng
)
const routeMode = randomChoice(
["strict","flexible"],
rng
)
const day = randomChoice(
["friday","saturday","sunday"],
rng
)
const walkingTime = randomChoice([1,2,3,4],rng)

let selectionCount = 9
let minStartHour = 17

if(scenario === "late-night"){
selectionCount = 6 + Math.floor(rng() * 4)
minStartHour = 19
}

if(scenario === "full-day"){
selectionCount = 10 + Math.floor(rng() * 4)
minStartHour = 14
}

if(scenario === "conflict-heavy"){
selectionCount = 8 + Math.floor(rng() * 4)
minStartHour = 17
}

return {
...TESTING_CONFIG,
day,
routeMode,
walkingTime,
scenario,
seed,
selectionCount,
minStartHour,
autoCalculate: true
}

}

async function runRandomTestingScenario(overrides = {}){

const config = {
...buildRandomTestingConfig(),
...overrides
}
const selection = await runTestingScenario(config)

logTestingRunSummary(config,selection)

return {
config,
selection
}

}

function updateTestingSummary(config){

const summary = document.getElementById("testingSummary")

if(!summary) return

if(!config){
summary.innerText = "Testing random activado"
return
}

summary.innerText =
`Seed ${config.seed} · ${config.day} · ${config.routeMode} · ${config.scenario} · ${config.selectionCount} shows`

}

function initializeTestingToolbar(){

const toolbar = document.getElementById("testingToolbar")
const button = document.getElementById("generateRandomTestBtn")

if(!toolbar || !button){
return
}

toolbar.hidden = !TESTING_CONFIG.enabled

if(!TESTING_CONFIG.enabled){
return
}

updateTestingSummary()

button.onclick = async ()=>{

button.disabled = true
button.innerText = "Generando..."

try{

const result = await runRandomTestingScenario()
updateTestingSummary(result.config)

}finally{

button.disabled = false
button.innerText = "🧪 Random test"

}

}

}


walkingTimeSelector.onchange = (e)=>{
walkingTime = Number(e.target.value)
calculateRoute()
}

async function loadDay(day){

const response = await fetch(`data/${day}.json`)
const data = await response.json()

stageOrder = data.stageOrder

shows = data.shows.map((s,i) => ({
  ...s,
  id: i,
  priority: 0
}))
selectedShows = []
routeGenerated = false
lastCalculatedRoute = []
routeHasCalculatedOnce = false
armedRemoveShowKey = null
routeResult.innerHTML = ""

renderLineup()
updateRouteButtonText()

}

function calculateRoute(){

if(routeMode === "strict"){
generateRoute()
}else{
generateRouteV2()
}

}

function renderLineup(){

hideArtistPreview()

const headerContainer = document.getElementById("stageHeaders")
headerContainer.innerHTML=""

const container = document.getElementById("lineupGrid")
container.innerHTML=""

/* primero calcular stages */

const stages = stageOrder.filter(stage =>
shows.some(show => show.stage === stage)
)

/* luego crear headers */

const headerSpacer = document.createElement("div")
headerSpacer.className = "timeColumn"
headerContainer.appendChild(headerSpacer)

stages.forEach(stage=>{

const header = document.createElement("div")
header.className = "stage-header"
header.innerText = stage

headerContainer.appendChild(header)

})

/* resto de tu lógica igual */

const timelineStart=13*60

const latestShow = Math.max(
...shows.map(s=>timeToMinutes(s.end))
)

const timelineEnd = latestShow + 30
const pxPerMinute=2

// columna de horas
const timeColumn=document.createElement("div")
timeColumn.className="timeColumn"
container.appendChild(timeColumn)

for(let t=timelineStart;t<=timelineEnd;t+=60){

const top=(t-timelineStart)*pxPerMinute

// etiqueta hora
const label=document.createElement("div")
label.className="time-label"

let hours = Math.floor(t/60)
const mins = t % 60

if(hours >= 24){
hours = hours - 24
}

label.innerText=`${hours}:${mins.toString().padStart(2,"0")}`
label.style.top=`${top}px`

timeColumn.appendChild(label)

// línea horizontal en columna de horas
const line=document.createElement("div")
line.className="time-line"
line.style.top=`${top}px`

timeColumn.appendChild(line)

}

// columnas de escenario
stages.forEach(stage=>{

const stageCol=document.createElement("div")
stageCol.className="stageColumn"

// líneas horizontales por hora
for(let t=timelineStart;t<=timelineEnd;t+=60){

const line=document.createElement("div")
line.className="hour-line"

const top=(t-timelineStart)*pxPerMinute
line.style.top=`${top}px`

stageCol.appendChild(line)

}

const stageShows = shows
.filter(s=>s.stage===stage)
.sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start))

stageShows.forEach(show=>{

const div=document.createElement("div")
div.className="show"
div.tabIndex = 0

div.dataset.id=show.id
div.dataset.artist=show.artist
div.dataset.start=show.start
div.dataset.stage=show.stage
div.dataset.priority = show.priority
div.title = "Click: seleccionar y abrir preview\nClick derecho: cambiar prioridad\nCon ruta calculada: click para mostrar X y quitar"

const start=timeToMinutes(show.start)
const end=timeToMinutes(show.end)

const top=(start-timelineStart)*pxPerMinute
const height=(end-start)*pxPerMinute

div.style.top=`${top}px`
div.style.height=`${height}px`

div.innerHTML=`
<div class="artist">${show.artist}</div>
<div class="time">${show.start}–${show.end}</div>
<div class="priority">${"⭐".repeat(show.priority)}</div>
`

const removeButton = document.createElement("button")
removeButton.type = "button"
removeButton.className = "show-remove-btn"
removeButton.innerText = "x"
removeButton.hidden = true
removeButton.title = "Quitar show de la selección"
removeButton.setAttribute("aria-label", `Quitar ${show.artist} de la selección`)

removeButton.onclick = (e)=>{

e.stopPropagation()

if(routeGenerated){
invalidateCalculatedRoute("explicit remove button", {
preserveRecalculateLabel: false
})
}

toggleShow(show,div,{ invalidateRoute: false })
setArmedRemoveShow(null)

}

div.appendChild(removeButton)

let suppressFocusPreview = false

div.onclick = ()=>{

if(longPressTriggered) return

if(routeGenerated && isShowSelected(show)){

const shouldArm = armedRemoveShowKey !== getShowKey(show)

setArmedRemoveShow(shouldArm ? show : null)
showArtistPreview(show)

debugSelectionState("toggle remove affordance", show, {
armed: shouldArm
})

return
}

toggleShow(show,div)
showArtistPreview(show)

}

div.addEventListener("mousedown", (event)=>{
suppressFocusPreview = event.button !== 0
})

div.addEventListener("focus", ()=>{
if(suppressFocusPreview){
suppressFocusPreview = false
return
}

showArtistPreview(show)
})

let pressTimer
let longPressTriggered = false

div.addEventListener("touchstart", ()=>{

longPressTriggered = false

pressTimer = setTimeout(()=>{

longPressTriggered = true

navigator.vibrate?.(40)

if(routeGenerated && isShowSelected(show)){
invalidateCalculatedRoute("long-press priority change", {
preserveRecalculateLabel: true
})
}

const previousPriority = show.priority

show.priority++

if(show.priority > 3){
show.priority = 0
}

div.querySelector(".priority").innerText = "⭐".repeat(show.priority)
div.dataset.priority = show.priority

debugSelectionState("long-press priority change", show, {
previousPriority,
nextPriority: show.priority,
wasSelected: selectedShows.some(s =>
s.artist === show.artist &&
s.start === show.start &&
s.stage === show.stage
)
})

},450)

})

div.addEventListener("touchend", ()=>{

clearTimeout(pressTimer)

})

div.addEventListener("touchmove", ()=>{

clearTimeout(pressTimer)

})

div.oncontextmenu = (e)=>{

e.preventDefault()
suppressFocusPreview = false

if(routeGenerated && isShowSelected(show)){
invalidateCalculatedRoute("contextmenu priority change", {
preserveRecalculateLabel: true
})
}

const previousPriority = show.priority

show.priority++

if(show.priority > 3){
show.priority = 0
}

div.querySelector(".priority").innerText = "⭐".repeat(show.priority)

div.dataset.priority = show.priority

debugSelectionState("contextmenu priority change", show, {
previousPriority,
nextPriority: show.priority,
wasSelected: selectedShows.some(s =>
s.artist === show.artist &&
s.start === show.start &&
s.stage === show.stage
)
})

}

stageCol.appendChild(div)

})

container.appendChild(stageCol)

})

rehydrateLineupState()

}

function toggleShow(show, element, options = {}){

const {
invalidateRoute = true
} = options

const index = findSelectedShowIndex(show)
const isRemoving = index !== -1

if(invalidateRoute && routeGenerated){
invalidateCalculatedRoute(
isRemoving ? "selection remove" : "selection add",
{
preserveRecalculateLabel: !isRemoving
}
)
}

if(!routeGenerated && isRemoving){
routeHasCalculatedOnce = false
}

setArmedRemoveShow(null)

if(isRemoving){

selectedShows.splice(index,1)
updateShowCardControls(show,element)
debugSelectionState("toggle remove", show)

}else{

selectedShows.push(show)
updateShowCardControls(show,element)
debugSelectionState("toggle add", show)

}

console.log("Seleccionados:", selectedShows)
checkConflicts()
updateMobileRouteButton()
updateRouteButtonText()
}

function timeToMinutes(time){

let [h,m] = time.split(":").map(Number)

if(h < 6){ // después de medianoche
h += 24
}

return h*60 + m

}

function getPriority(show){

return Number(show.priority) || 0

}

function getShowDuration(show){

return timeToMinutes(show.end) - timeToMinutes(show.start)

}

function getStageTransitionMinutes(fromStage,toStage){

if(!fromStage || !toStage || fromStage === toStage){
return 0
}

return walkingTime

}

function getArrivalTime(currentTime,currentStage,show){

if(!currentStage || currentStage === show.stage){
return currentTime
}

return currentTime + walkingTime

}

function getVisibleWindow(show,currentTime,currentStage,endLimit){

const hardEnd = endLimit ?? timeToMinutes(show.end)
const start = Math.max(
timeToMinutes(show.start),
getArrivalTime(currentTime,currentStage,show)
)
const end = Math.min(timeToMinutes(show.end), hardEnd)

return {
start,
end,
visible: Math.max(0,end - start)
}

}

function buildConflictGroups(list){

const sorted = [...list].sort((a,b)=>{
const startDiff = timeToMinutes(a.start) - timeToMinutes(b.start)

if(startDiff !== 0){
return startDiff
}

return timeToMinutes(a.end) - timeToMinutes(b.end)
})

const groups = []

sorted.forEach(show=>{

const start = timeToMinutes(show.start)
const end = timeToMinutes(show.end)
const lastGroup = groups[groups.length - 1]

if(!lastGroup || start >= lastGroup.end){
groups.push({
shows:[show],
start,
end
})
return
}

lastGroup.shows.push(show)
lastGroup.end = Math.max(lastGroup.end,end)

})

return groups

}

function getProtectedEnd(show,pool){

const baseEnd = timeToMinutes(show.end)
const showPriority = getPriority(show)
let protectedEnd = baseEnd

pool.forEach(other=>{

if(other === show) return

const otherPriority = getPriority(other)

if(otherPriority <= showPriority){
return
}

const otherStart = timeToMinutes(other.start)

if(otherStart <= timeToMinutes(show.start)){
return
}

const safeExit = otherStart - getStageTransitionMinutes(show.stage,other.stage)

if(safeExit < protectedEnd){
protectedEnd = safeExit
}

})

return protectedEnd

}

function sortShowsForStrict(candidates,currentStage,lastArtist,currentTime,pool){

return [...candidates].sort((a,b)=>{
const prDiff = getPriority(b) - getPriority(a)

if(prDiff !== 0){
return prDiff
}

const sameStageA = currentStage && a.stage === currentStage ? 1 : 0
const sameStageB = currentStage && b.stage === currentStage ? 1 : 0

if(sameStageB !== sameStageA){
return sameStageB - sameStageA
}

const sameArtistA = lastArtist && a.artist === lastArtist ? 1 : 0
const sameArtistB = lastArtist && b.artist === lastArtist ? 1 : 0

if(sameArtistB !== sameArtistA){
return sameArtistB - sameArtistA
}

const visibleA = getVisibleWindow(a,currentTime,currentStage,getProtectedEnd(a,pool)).visible
const visibleB = getVisibleWindow(b,currentTime,currentStage,getProtectedEnd(b,pool)).visible

if(visibleB !== visibleA){
return visibleB - visibleA
}

const durationDiff = getShowDuration(b) - getShowDuration(a)

if(durationDiff !== 0){
return durationDiff
}

return timeToMinutes(a.start) - timeToMinutes(b.start)
})

}

function sortShowsForFlexible(candidates,currentStage,lastArtist){

return [...candidates].sort((a,b)=>{
const prDiff = getPriority(b) - getPriority(a)

if(prDiff !== 0){
return prDiff
}

const sameArtistA = lastArtist && a.artist === lastArtist ? 1 : 0
const sameArtistB = lastArtist && b.artist === lastArtist ? 1 : 0

if(sameArtistB !== sameArtistA){
return sameArtistB - sameArtistA
}

const sameStageA = currentStage && a.stage === currentStage ? 1 : 0
const sameStageB = currentStage && b.stage === currentStage ? 1 : 0

if(sameStageB !== sameStageA){
return sameStageB - sameStageA
}

const durationDiff = getShowDuration(b) - getShowDuration(a)

if(durationDiff !== 0){
return durationDiff
}

return timeToMinutes(a.start) - timeToMinutes(b.start)
})

}

function appendRoutePart(route,show,startReal,endReal){

if(endReal - startReal < MIN_VISIBLE_MINUTES){
return
}

const last = route[route.length - 1]

if(last && last.artist === show.artist && last.stage === show.stage){
last.endReal = Math.max(last.endReal,endReal)
return
}

route.push({
...show,
startReal,
endReal
})

}

function planFlexibleSplit(primary,secondary,segmentStart,segmentEnd){

const duration = segmentEnd - segmentStart
const primaryPriority = getPriority(primary)
const secondaryPriority = getPriority(secondary)
const diff = Math.abs(primaryPriority - secondaryPriority)

if(duration < MIN_SPLIT * 2){
return [{
show: primary,
start: segmentStart,
end: segmentEnd
}]
}

if(diff >= 2){
return [{
show: primary,
start: segmentStart,
end: segmentEnd
}]
}

if(diff === 0){

const mid = segmentStart + Math.floor(duration / 2)

return [
{
show: primary,
start: segmentStart,
end: mid
},
{
show: secondary,
start: mid,
end: segmentEnd
}
]

}

const weightedPrimary = primaryPriority >= secondaryPriority ? 0.6 : 0.4
const primaryDuration = Math.floor(duration * weightedPrimary)
const mid = segmentStart + primaryDuration

return [
{
show: primary,
start: segmentStart,
end: mid
},
{
show: secondary,
start: mid,
end: segmentEnd
}
]

}

function rebalanceAlternatingRoute(route){

const balanced = []
let index = 0

while(index < route.length){

const a1 = route[index]
const b1 = route[index + 1]
const a2 = route[index + 2]
const b2 = route[index + 3]

const isAlternating =
a1 &&
b1 &&
a2 &&
b2 &&
a1.artist === a2.artist &&
b1.artist === b2.artist &&
a1.artist !== b1.artist

if(!isAlternating){
balanced.push(route[index])
index += 1
continue
}

const transition = getStageTransitionMinutes(a1.stage,b1.stage)
const blockStart = a1.startReal
const blockEnd = b2.endReal
const usableDuration = blockEnd - blockStart - transition

if(usableDuration < MIN_SPLIT * 2){
balanced.push(route[index])
index += 1
continue
}

const priorityA = Math.max(getPriority(a1),getPriority(a2))
const priorityB = Math.max(getPriority(b1),getPriority(b2))
const totalPriority = Math.max(1,priorityA + priorityB)

let durationA = Math.floor(usableDuration * (priorityA / totalPriority))
let durationB = usableDuration - durationA

if(priorityA === priorityB){
durationA = Math.floor(usableDuration / 2)
durationB = usableDuration - durationA
}

if(durationA < MIN_SPLIT || durationB < MIN_SPLIT){
balanced.push(route[index])
index += 1
continue
}

balanced.push({
...a1,
startReal:blockStart,
endReal:blockStart + durationA
})

balanced.push({
...b1,
startReal:blockStart + durationA + transition,
endReal:blockEnd
})

index += 4

}

return balanced

}

function hasConflict(showA, showB){

const startA = timeToMinutes(showA.start)
const endA = timeToMinutes(showA.end)

const startB = timeToMinutes(showB.start)
const endB = timeToMinutes(showB.end)

return startA < endB && startB < endA

}

function blocksImportantFutureShow(show){

const start = timeToMinutes(show.start)
const end   = timeToMinutes(show.end)
const pr    = Number(show.priority)

for(const other of selectedShows){

if(other === show) continue

const otherStart = timeToMinutes(other.start) - walkingTime
const otherPr    = Number(other.priority)

/* solo mirar shows futuros */

if(otherStart <= start) continue

/* si el show actual invade el siguiente */

if(end > otherStart){

/* y el siguiente es mucho más importante */

if(otherPr >= pr + 2){
return true
}

}

}

return false

}

function cannotReachNext(showA, showB){

if(showA.stage === showB.stage){
return false
}

const endA = timeToMinutes(showA.end)
const startB = timeToMinutes(showB.start)

return endA + walkingTime > startB

}

function getStrictFrontierTime(shows,currentTime){

const times = shows
.filter(show=>timeToMinutes(show.end) > currentTime)
.map(show=>Math.max(currentTime,timeToMinutes(show.start)))

if(times.length === 0){
return null
}

return Math.min(...times)

}

function getShowsActiveAt(shows,time){

return shows.filter(show=>
timeToMinutes(show.start) <= time &&
timeToMinutes(show.end) > time
)

}

function hasHigherPriorityDirectOverlap(show,pool,frontierTime){

return pool.some(other=>{

if(other === show) return false

if(getPriority(other) <= getPriority(show)){
return false
}

if(timeToMinutes(other.end) <= frontierTime){
return false
}

return hasConflict(show,other)

})

}

function getNextStrictStart(shows,afterTime){

const starts = shows
.map(show=>timeToMinutes(show.start))
.filter(start=>start > afterTime)

if(starts.length === 0){
return null
}

return Math.min(...starts)

}

function generateRoute(){

debugGroup("[STRICT] generateRoute")
debugLog("[STRICT] selected shows", selectedShows.map(describeShow))

const allShows=document.querySelectorAll(".show")

allShows.forEach(el=>{
el.classList.remove("route")
el.classList.remove("rejected")
})

if(selectedShows.length === 0){
debugLog("[STRICT] no selected shows")
displayRoute([])
markRouteOnGrid([])
debugGroupEnd()
return
}

const groups = buildConflictGroups(selectedShows)
debugLog("[STRICT] conflict groups", groups.map((group,index)=>({
group:index,
start:formatMinutes(group.start),
end:formatMinutes(group.end),
shows:group.shows.map(describeShow)
})))

let route = []
let currentTime = 0
let currentStage = null

groups.forEach(group=>{

debugGroup(`[STRICT] group ${formatMinutes(group.start)}-${formatMinutes(group.end)}`)

let remaining = [...group.shows]

while(group.end > currentTime){

debugLog("[STRICT] loop state", {
currentTime: formatMinutes(currentTime),
currentStage
})

remaining = remaining.filter(show=>
timeToMinutes(show.end) > currentTime
)

if(remaining.length === 0){
debugLog("[STRICT] no candidates remain in group")
break
}

const frontierTime = getStrictFrontierTime(remaining,currentTime)

if(frontierTime === null){
debugLog("[STRICT] no frontier time found")
break
}

const activeShows = getShowsActiveAt(remaining,frontierTime)
const candidates = activeShows.filter(show=>
!hasHigherPriorityDirectOverlap(show,remaining,frontierTime)
)

debugLog("[STRICT] frontier", {
frontierTime: formatMinutes(frontierTime),
activeShows: activeShows.map(describeShow),
remaining: remaining.map(describeShow),
filteredCandidates: candidates.map(describeShow)
})

if(candidates.length === 0){

const nextStart = getNextStrictStart(remaining,frontierTime)

debugLog("[STRICT] no valid candidates at frontier, advancing time", {
from: formatMinutes(currentTime),
frontierTime: formatMinutes(frontierTime),
nextStart: nextStart === null ? null : formatMinutes(nextStart)
})

if(nextStart === null){
break
}

currentTime = Math.max(currentTime,nextStart)
continue
}

const ranked = sortShowsForStrict(
candidates,
currentStage,
route[route.length - 1]?.artist ?? null,
currentTime,
remaining
)

debugLog("[STRICT] ranked candidates", ranked.map(show=>{
const protectedEnd = getProtectedEnd(show,remaining)
const window = getVisibleWindow(show,currentTime,currentStage,protectedEnd)

return {
show: describeShow(show),
protectedEnd: formatMinutes(protectedEnd),
startReal: formatMinutes(window.start),
endReal: formatMinutes(window.end),
visible: window.visible,
arrival: formatMinutes(getArrivalTime(currentTime,currentStage,show))
}
}))

let picked = false
let chosenShow = null
let chosenWindow = null

for(const show of ranked){

const protectedEnd = getProtectedEnd(show,remaining)
const window = getVisibleWindow(show,currentTime,currentStage,protectedEnd)

debugLog("[STRICT] evaluate candidate", {
show: describeShow(show),
protectedEnd: formatMinutes(protectedEnd),
arrival: formatMinutes(getArrivalTime(currentTime,currentStage,show)),
windowStart: formatMinutes(window.start),
windowEnd: formatMinutes(window.end),
visible: window.visible
})

if(window.visible < MIN_VISIBLE_MINUTES){
debugLog("[STRICT] reject candidate: visible window too small", {
show: describeShow(show),
visible: window.visible,
minRequired: MIN_VISIBLE_MINUTES
})
continue
}

appendRoutePart(route,show,window.start,window.end)
currentTime = window.end
currentStage = show.stage
picked = true
chosenShow = show
chosenWindow = window
debugLog("[STRICT] picked candidate", {
show: describeShow(show),
startReal: formatMinutes(window.start),
endReal: formatMinutes(window.end),
routeLength: route.length
})
break
}

if(!picked){

const nextStart = getNextStrictStart(remaining,frontierTime)

debugLog("[STRICT] no viable candidate found in current loop iteration", {
frontierTime: formatMinutes(frontierTime),
nextStart: nextStart === null ? null : formatMinutes(nextStart)
})

if(nextStart === null){
break
}

currentTime = Math.max(currentTime,nextStart)
continue
}

const removedShows = remaining.filter(show=>
show === chosenShow || hasConflict(show,chosenShow)
)

debugLog("[STRICT] remove overlapping shows after pick", {
picked: describeShow(chosenShow),
pickedWindow: {
start: formatMinutes(chosenWindow.start),
end: formatMinutes(chosenWindow.end)
},
removedShows: removedShows.map(describeShow)
})

remaining = remaining.filter(show=>
show !== chosenShow && !hasConflict(show,chosenShow)
)
}

debugGroupEnd()
})

debugLog("[STRICT] final route", route.map(show=>({
show: describeShow(show),
startReal: formatMinutes(show.startReal),
endReal: formatMinutes(show.endReal)
})))

displayRoute(route)
markRouteOnGrid(route)

lastCalculatedRoute = route.map(show => ({
...show
}))
routeGenerated = true
routeHasCalculatedOnce = true
setArmedRemoveShow(null)
updateRouteButtonText()
debugGroupEnd()

}

function generateRouteV2(){

debugGroup("[FLEX] generateRouteV2")
debugLog("[FLEX] selected shows", selectedShows.map(describeShow))

const allShows = document.querySelectorAll(".show")
allShows.forEach(el=>{
el.classList.remove("route")
el.classList.remove("rejected")
})

const candidateShows = [...selectedShows]

if(candidateShows.length === 0){
debugLog("[FLEX] no selected shows")
displayRoute([])
markRouteOnGrid([])
debugGroupEnd()
return
}

let timestamps = new Set()

candidateShows.forEach(s=>{
timestamps.add(timeToMinutes(s.start))
timestamps.add(timeToMinutes(s.end))
})

timestamps = [...timestamps].sort((a,b)=>a-b)
debugLog("[FLEX] timestamps", timestamps.map(formatMinutes))

let segments = []

for(let i=0;i<timestamps.length-1;i++){

const segmentStart = timestamps[i]
const segmentEnd = timestamps[i+1]

let active = candidateShows.filter(s=>{
const start = timeToMinutes(s.start)
const end = timeToMinutes(s.end)
return start < segmentEnd && end > segmentStart
})

if(active.length === 0) continue

active.sort((a,b)=>{
if(b.priority !== a.priority){
return b.priority - a.priority
}
return timeToMinutes(a.start) - timeToMinutes(b.start)
})

segments.push({
shows: active,
start: segmentStart,
end: segmentEnd
})

}

debugLog("[FLEX] segments", segments.map((seg,index)=>({
segment:index,
start:formatMinutes(seg.start),
end:formatMinutes(seg.end),
shows:seg.shows.map(describeShow)
})))

let route = []
let currentStage = null
let currentTime = 0

segments.forEach(seg=>{

debugGroup(`[FLEX] segment ${formatMinutes(seg.start)}-${formatMinutes(seg.end)}`)
debugLog("[FLEX] segment state", {
currentTime: formatMinutes(currentTime),
currentStage,
shows: seg.shows.map(describeShow)
})

const ranked = sortShowsForFlexible(
seg.shows,
currentStage,
route[route.length - 1]?.artist ?? null
)

const primary = ranked[0]
const secondary = ranked[1]

const plan = secondary
? planFlexibleSplit(primary,secondary,seg.start,seg.end)
: [{
show: primary,
start: seg.start,
end: seg.end
}]

debugLog("[FLEX] ranked candidates", ranked.map(describeShow))
debugLog("[FLEX] chosen plan", plan.map(part=>({
show: describeShow(part.show),
start: formatMinutes(part.start),
end: formatMinutes(part.end)
})))

plan.forEach(part=>{

const arrival = getArrivalTime(currentTime,currentStage,part.show)
const startReal = Math.max(part.start,arrival)
const endReal = part.end

debugLog("[FLEX] evaluate part", {
show: describeShow(part.show),
plannedStart: formatMinutes(part.start),
plannedEnd: formatMinutes(part.end),
arrival: formatMinutes(arrival),
startReal: formatMinutes(startReal),
endReal: formatMinutes(endReal),
visible: endReal - startReal
})

if(endReal - startReal < MIN_VISIBLE_MINUTES){
debugLog("[FLEX] reject part: visible window too small", {
show: describeShow(part.show),
visible: endReal - startReal,
minRequired: MIN_VISIBLE_MINUTES
})
return
}

appendRoutePart(route,part.show,startReal,endReal)
currentTime = endReal
currentStage = part.show.stage
debugLog("[FLEX] accepted part", {
show: describeShow(part.show),
startReal: formatMinutes(startReal),
endReal: formatMinutes(endReal),
routeLength: route.length
})
})

debugGroupEnd()
})

route = rebalanceAlternatingRoute(route)
debugLog("[FLEX] final route after rebalance", route.map(show=>({
show: describeShow(show),
startReal: formatMinutes(show.startReal),
endReal: formatMinutes(show.endReal)
})))

displayRoute(route)
markRouteOnGrid(route)

lastCalculatedRoute = route.map(show => ({
...show
}))
routeGenerated = true
routeHasCalculatedOnce = true
setArmedRemoveShow(null)
updateRouteButtonText()
debugGroupEnd()

}

function displayRoute(route){

routeResult.innerHTML=""

route.forEach((show,index)=>{

if(index>0){

const prev=route[index-1]

if(prev.stage!==show.stage){

const walk=document.createElement("div")
walk.className="walk"
walk.innerText = `↓ Muévete hacia ${show.stage} Stage · ${walkingTime} min`

routeResult.appendChild(walk)

}

}

const div=document.createElement("div")
div.className="route-item"

let start=show.startReal ?? timeToMinutes(show.start)
let end=show.endReal ?? timeToMinutes(show.end)

if(show.visibleMinutes){

end=start+show.visibleMinutes

}

const startH=(Math.floor(start/60)) % 24
const startM=(start%60).toString().padStart(2,"0")

const endH=(Math.floor(end/60)) % 24
const endM=(end%60).toString().padStart(2,"0")

const timeText=`${startH}:${startM} - ${endH}:${endM}`

div.innerHTML=`
${timeText}
<br>
${show.artist}
<br>
${show.stage}
`

routeResult.appendChild(div)

})

}

function updateRouteButtonText(){

const btn = document.getElementById("generateRouteMobile")
if(!btn) return

if(routeGenerated || routeHasCalculatedOnce){
btn.innerText = "🔄 Recalcular ruta"
}else{
btn.innerText = "⚡ Generar ruta"
}

updateShareButtonsState()

}

function updateShareButtonsState(){

const shareButtons = [
document.getElementById("copyRouteImage"),
document.getElementById("copyLink"),
document.getElementById("instagramShare"),
document.getElementById("facebookShare")
]
const enabled = hasGeneratedShareRoute()

shareButtons.forEach(button=>{
if(!button) return
button.disabled = !enabled
button.setAttribute("aria-disabled", enabled ? "false" : "true")
})

}

function clearSelection(){

selectedShows = []
lastCalculatedRoute = []
routeHasCalculatedOnce = false
armedRemoveShowKey = null
hideArtistPreview()

const allShows = document.querySelectorAll(".show")

allShows.forEach(el => {

el.classList.remove("selected")
el.classList.remove("conflict")
el.classList.remove("route")
el.classList.remove("rejected")

})

routeResult.innerHTML = ""
updateMobileRouteButton()
routeGenerated = false
updateRouteButtonText()
}

function checkConflicts(){

const allShows = document.querySelectorAll(".show")

/* limpiar conflictos */

allShows.forEach(el=>{
el.classList.remove("conflict")
})

/* comparar shows seleccionados */

selectedShows.forEach(showA=>{
selectedShows.forEach(showB=>{

if(showA === showB) return

if(hasConflict(showA, showB)){
markConflict(showA)
markConflict(showB)
}

})

})

}

function markConflict(show){

const el = document.querySelector(
`.show[data-artist="${show.artist}"][data-start="${show.start}"][data-stage="${show.stage}"]`
)

if(el){
el.classList.add("conflict")
}

}


function markRouteOnGrid(route){

debugGroup("[UI] markRouteOnGrid")
debugLog("[UI] route entries", route.map(describeShow))
debugLog("[UI] selected entries", selectedShows.map(describeShow))

const allShows=document.querySelectorAll(".show")

allShows.forEach(el=>{
el.classList.remove("route")
el.classList.remove("rejected")
})

/* marcar ruta */

route.forEach(show=>{

const el=document.querySelector(
`.show[data-artist="${show.artist}"][data-start="${show.start}"][data-stage="${show.stage}"]`
)

if(el){
el.classList.add("route")
updateShowCardControls(show,el)
debugLog("[UI] mark route", describeShow(show))
}

})

/* marcar rechazados */

selectedShows.forEach(show=>{

const inRoute = route.some(r =>
r.artist===show.artist &&
r.start===show.start &&
r.stage===show.stage
)

if(!inRoute){

const el=document.querySelector(
`.show[data-artist="${show.artist}"][data-start="${show.start}"][data-stage="${show.stage}"]`
)

if(el){
el.classList.add("rejected")
updateShowCardControls(show,el)
debugLog("[UI] mark rejected", describeShow(show))
}

}

})

debugGroupEnd()

}

async function handleArtistSearch(){

const query = artistSearch.value.toLowerCase().trim()

const isTyping = query.length > previousSearchLength
previousSearchLength = query.length

const allShows = document.querySelectorAll(".show")
const allStages = document.querySelectorAll(".stageColumn")

/* limpiar highlights */
allShows.forEach(el=>el.classList.remove("search-hit"))
allStages.forEach(el=>el.classList.remove("search-stage"))

if(query.length < 2){
lastScrolledShowId = null
return
}

/* buscar en shows cargados */
const matches = shows.filter(show =>
show.artist.toLowerCase().includes(query)
)

highlightSearchResults(matches)

/* highlight columna del escenario */
if(matches.length > 0){

const stage = matches[0].stage

const stageCol = [...document.querySelectorAll(".stageColumn")]
.find(col => col.querySelector(`.show[data-stage="${stage}"]`))

if(stageCol){
stageCol.classList.add("search-stage")
}

}

/* scroll solo si está escribiendo */
if(matches.length > 0 && isTyping){

const firstMatch = matches[0]

const showId = `${firstMatch.artist}-${firstMatch.start}-${firstMatch.stage}`

/* evitar scroll repetido */
if(showId !== lastScrolledShowId){

const el = document.querySelector(
`.show[data-artist="${firstMatch.artist}"][data-start="${firstMatch.start}"][data-stage="${firstMatch.stage}"]`
)

if(el){
el.scrollIntoView({
behavior:"smooth",
block:"center",
inline:"center"
})

lastScrolledShowId = showId
}

}

}

/* buscar en otros días si no aparece */
if(matches.length === 0){

const days = ["friday","saturday","sunday"]

for(const day of days){

if(day === daySelector.value) continue

const response = await fetch(`data/${day}.json`)
const data = await response.json()

const found = data.shows.find(show =>
show.artist.toLowerCase().includes(query)
)

if(found){

daySelector.value = day
loadDay(day)

setTimeout(()=>{
artistSearch.value = query
},100)

break
}

}

}

}

function highlightSearchResults(matches){

const allShows = document.querySelectorAll(".show")

// limpiar highlights anteriores
allShows.forEach(el=>{
el.classList.remove("search-hit")
})

let firstMatch = null

matches.forEach(show=>{

const el = document.querySelector(
`.show[data-artist="${show.artist}"][data-start="${show.start}"][data-stage="${show.stage}"]`
)

if(el){

el.classList.add("search-hit")

if(!firstMatch){
firstMatch = el
}

}

})

// hacer scroll al primer resultado
if(firstMatch){
firstMatch.scrollIntoView({
behavior:"smooth",
block:"center",
inline:"center"
})
}

}

function generateShareURL(){

const routeData = {
d: daySelector.value,
w: walkingTime,
s: selectedShows.map(({id,priority}) => ({
id,
p: priority
}))
}

const encoded = LZString.compressToEncodedURIComponent(
JSON.stringify(routeData)
)

return `${location.origin}${location.pathname}?route=${encoded}`

}

function hasGeneratedShareRoute(){

return routeGenerated && lastCalculatedRoute.length > 0

}

function ensureShareableRoute(){

if(hasGeneratedShareRoute()){
return true
}

showToast("Genera la ruta antes de compartir.")
return false

}

function getCurrentDayLabel(){

return daySelector.selectedOptions?.[0]?.textContent?.trim() || daySelector.value

}

function getCurrentModeLabel(){

return routeMode === "flexible"
? "Flexible"
: "Estricto"

}

function sanitizeFileSegment(value){

return String(value)
.normalize("NFD")
.replace(/[\u0300-\u036f]/g,"")
.toLowerCase()
.replace(/[^a-z0-9]+/g,"-")
.replace(/^-+|-+$/g,"")

}

function waitForNextFrame(){

return new Promise(resolve => requestAnimationFrame(()=>resolve()))

}

function canvasToBlob(canvas,type = "image/png", quality = 1){

return new Promise((resolve,reject)=>{
canvas.toBlob(blob=>{
if(blob){
resolve(blob)
return
}

reject(new Error("canvas-to-blob-failed"))
}, type, quality)
})

}

async function copyImageBlobToClipboard(blob){

if(!navigator.clipboard?.write || typeof ClipboardItem === "undefined"){
return false
}

await navigator.clipboard.write([
new ClipboardItem({
[blob.type]: blob
})
])

return true

}

function downloadBlob(blob,fileName){

const objectUrl = URL.createObjectURL(blob)
const anchor = document.createElement("a")
anchor.href = objectUrl
anchor.download = fileName
document.body.appendChild(anchor)
anchor.click()
anchor.remove()
setTimeout(()=>URL.revokeObjectURL(objectUrl), 1000)

}

function applyExportColumnWidths(sourceChildren,cloneChildren){

cloneChildren.forEach((cloneChild,index)=>{
const sourceChild = sourceChildren[index]

if(!sourceChild) return

const width = Math.ceil(
sourceChild.getBoundingClientRect().width
|| sourceChild.scrollWidth
|| sourceChild.offsetWidth
|| 0
)

if(width <= 0) return

cloneChild.style.flex = `0 0 ${width}px`
cloneChild.style.width = `${width}px`
cloneChild.style.minWidth = `${width}px`
cloneChild.style.maxWidth = `${width}px`
})

}

function buildRouteImageExportNode(){

const stageHeaders = document.getElementById("stageHeaders")
const lineupGrid = document.getElementById("lineupGrid")

if(!stageHeaders || !lineupGrid){
throw new Error("lineup-export-missing")
}

const exportHost = document.createElement("div")
exportHost.className = "routeImageExportHost"

const exportSurface = document.createElement("section")
exportSurface.className = "routeImageExportSurface"

const exportHeader = document.createElement("div")
exportHeader.className = "routeImageExportHeader"

const exportEyebrow = document.createElement("div")
exportEyebrow.className = "routeImageExportEyebrow"
exportEyebrow.innerText = `${getCurrentDayLabel()} · ${getCurrentModeLabel()}`

const exportTitle = document.createElement("h2")
exportTitle.className = "routeImageExportTitle"
exportTitle.innerText = "Mi ruta del festival"

const exportMeta = document.createElement("div")
exportMeta.className = "routeImageExportMeta"
exportMeta.innerText = `${lastCalculatedRoute.length} bloques · ${walkingTime} min entre escenarios`

exportHeader.append(exportEyebrow, exportTitle, exportMeta)

const headerClone = stageHeaders.cloneNode(true)
headerClone.id = ""
headerClone.className = "routeImageExportHeaders"

const gridClone = lineupGrid.cloneNode(true)
gridClone.id = ""
gridClone.className = "routeImageExportGrid"

gridClone.querySelectorAll(".show-remove-btn").forEach(button=>button.remove())
gridClone.querySelectorAll(".show-remove-armed").forEach(show=>{
show.classList.remove("show-remove-armed")
})

const headerSourceChildren = Array.from(stageHeaders.children)
const headerCloneChildren = Array.from(headerClone.children)
applyExportColumnWidths(headerSourceChildren, headerCloneChildren)

const gridSourceChildren = Array.from(lineupGrid.children)
const gridCloneChildren = Array.from(gridClone.children)
applyExportColumnWidths(gridSourceChildren, gridCloneChildren)

const exportGridHeight = Math.ceil(lineupGrid.scrollHeight || lineupGrid.getBoundingClientRect().height || 0)

gridCloneChildren.forEach(child=>{
if(child.classList.contains("timeColumn")){
child.style.height = `${exportGridHeight}px`
}

if(child.classList.contains("stageColumn")){
child.style.minHeight = `${exportGridHeight}px`
child.style.height = `${exportGridHeight}px`
}
})

headerClone.querySelectorAll(".stage-header").forEach(header=>{
header.style.position = "relative"
header.style.top = "auto"
})

const exportBoard = document.createElement("div")
exportBoard.className = "routeImageExportBoard"
exportBoard.style.width = `${Math.ceil(Math.max(stageHeaders.scrollWidth, lineupGrid.scrollWidth))}px`

exportBoard.append(headerClone, gridClone)
exportSurface.append(exportHeader, exportBoard)
exportHost.appendChild(exportSurface)
document.body.appendChild(exportHost)

return {
host: exportHost,
surface: exportSurface
}

}

async function exportRouteImage(){

if(!ensureShareableRoute()){
return
}

if(typeof window.html2canvas !== "function"){
showToast("No se pudo cargar el exportador de imagen.")
return
}

showToast("Preparando imagen de la ruta...")

const { host, surface } = buildRouteImageExportNode()

try{
await document.fonts?.ready
await waitForNextFrame()
await waitForNextFrame()

const width = Math.ceil(surface.scrollWidth)
const height = Math.ceil(surface.scrollHeight)
const scale = Math.min(3, Math.max(window.devicePixelRatio || 1, 2))

const canvas = await window.html2canvas(surface, {
backgroundColor: themeMode === "dark" ? "#020617" : "#f1f5f9",
scale,
useCORS: true,
logging: false,
width,
height,
windowWidth: width,
windowHeight: height
})

const blob = await canvasToBlob(canvas)
const fileName = `festival-route-${sanitizeFileSegment(getCurrentDayLabel())}-${sanitizeFileSegment(getCurrentModeLabel())}.png`

try{
const copied = await copyImageBlobToClipboard(blob)

if(copied){
showToast("Imagen copiada al portapapeles.")
}else{
downloadBlob(blob, fileName)
showToast("Tu navegador no pudo copiar la imagen. Se descargo un PNG.")
}
}catch(error){
downloadBlob(blob, fileName)
showToast("Tu navegador no pudo copiar la imagen. Se descargo un PNG.")
}

}finally{
host.remove()
}

}

function loadRouteFromURL(){

const params = new URLSearchParams(window.location.search)
const route = params.get("route")

if(!route) return

try{

const data = JSON.parse(
LZString.decompressFromEncodedURIComponent(route)
)

// usar claves cortas
walkingTime = data.w
walkingTimeSelector.value = data.w
daySelector.value = data.d

loadDay(data.d).then(()=>{

clearSelection()

data.s.forEach(item=>{

const show = shows.find(s=>s.id === item.id)

if(!show) return

// aplicar prioridad
show.priority = item.p || 0

const el = document.querySelector(
`.show[data-artist="${show.artist}"][data-start="${show.start}"][data-stage="${show.stage}"]`
)

if(el){

// actualizar estrellas
el.querySelector(".priority").innerText = "⭐".repeat(show.priority)

// seleccionar show
toggleShow(show, el)

}

})

})

}catch(e){

console.error("Error loading route", e)

}

}

function updateMobileRouteButton(){

const routeBtn = document.getElementById("generateRouteMobile")
const clearBtn = document.getElementById("clearSelectionBtn")

if(selectedShows.length > 0){

if(routeBtn) routeBtn.style.display = "block"
if(clearBtn) clearBtn.style.display = "flex"

}else{

if(routeBtn) routeBtn.style.display = "none"
if(clearBtn) clearBtn.style.display = "none"

}

}

let toastTimeout

function showToast(message){

const toast = document.getElementById("modeToast")
if(!toast) return

toast.innerText = message

toast.classList.add("show")

clearTimeout(toastTimeout)

toastTimeout = setTimeout(()=>{
toast.classList.remove("show")
},2200)

}

function showModeToast(mode){

if(mode==="strict"){
showToast("🎯 Modo estricto: prioriza los shows con más estrellas.")
}

if(mode==="flexible"){
showToast("⚡ Modo flexible: divide shows cercanos para ver más artistas.")
}

}

document.addEventListener("DOMContentLoaded", async ()=>{

loadSpotifyPreviewDatabase()

const clearBtn = document.getElementById("clearSelectionBtn")

if(clearBtn){
clearBtn.onclick = clearSelection
}

if(artistPreviewBody){
artistPreviewBody.addEventListener("click", (event)=>{

const trackButton = event.target.closest(".artistPreviewTrack")

if(!trackButton || !activePreviewData){
return
}

const trackIndex = Number(trackButton.dataset.trackIndex)

if(Number.isNaN(trackIndex)){
return
}

if(trackIndex === activePreviewTrackIndex){
return
}

loadPreviewTrack(activePreviewData, trackIndex)
})
}

if(artistPreviewClose){
artistPreviewClose.onclick = hideArtistPreview
}

document.addEventListener("keydown", (event)=>{

if(event.key === "Escape" && artistPreviewPanel && !artistPreviewPanel.hidden){
hideArtistPreview()
}

})

/* switch strict / flexible */

const modeSwitch = document.getElementById("routeModeSwitch")
const strictModeLabel = document.getElementById("strictModeLabel")
const flexibleModeLabel = document.getElementById("flexibleModeLabel")
const themeSwitch = document.getElementById("themeSwitch")

modeSwitch.onclick = ()=>{

setRouteMode(
modeSwitch.classList.contains("active")
? "strict"
: "flexible"
)

}

if(themeSwitch){
themeSwitch.onclick = ()=>{
setThemeMode(
themeSwitch.classList.contains("active")
? "light"
: "dark"
)
}
}

const mobileBtn = document.getElementById("generateRouteMobile")

if(mobileBtn){
mobileBtn.onclick = calculateRoute
}

const copyImageBtn = document.getElementById("copyRouteImage")
const copyLinkBtn = document.getElementById("copyLink")
const facebookBtn = document.getElementById("facebookShare")
const instagramBtn = document.getElementById("instagramShare")

async function copyShareUrlToClipboard(){

const url = generateShareURL()

await navigator.clipboard.writeText(url)

return url

}

copyImageBtn.onclick = async () => {

if(!ensureShareableRoute()){
return
}

try{
await exportRouteImage()
}catch{
showToast("No se pudo preparar la imagen de la ruta.")
}

}

if(copyLinkBtn){
copyLinkBtn.onclick = async () => {

if(!ensureShareableRoute()){
return
}

try{
await copyShareUrlToClipboard()
showToast("🔗 Link copiado al portapapeles")
}catch{
showToast("No se pudo copiar el link automaticamente.")
}

}
}

facebookBtn.onclick = () => {

if(!ensureShareableRoute()){
return
}

const url = encodeURIComponent(generateShareURL())

window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`)

}

instagramBtn.onclick = () => {

if(!ensureShareableRoute()){
return
}

copyShareUrlToClipboard()
.then(()=>{
window.open("https://www.instagram.com/direct/inbox/", "_blank", "noopener")
showToast("📩 Link copiado. Abre tu DM de Instagram y pegalo.")
})
.catch(()=>{
showToast("No se pudo copiar el link, pero puedes compartirlo manualmente.")
window.open("https://www.instagram.com/direct/inbox/", "_blank", "noopener")
})

}

daySelector.onchange = ()=>loadDay(daySelector.value).then(()=>{

updateTestingSummary()

})

artistSearch.addEventListener("input", handleArtistSearch)

artistSearch.addEventListener("keydown", (e)=>{
if(e.key === "Escape"){
artistSearch.value=""
renderLineup()
}
})

window.runTestingScenario = runTestingScenario
window.runRandomTestingScenario = runRandomTestingScenario
window.TESTING_CONFIG = TESTING_CONFIG

initializeTestingToolbar()
setThemeMode(getInitialThemeMode(), {
announce: false,
persist: false
})

const initialDay = TESTING_CONFIG.enabled
? TESTING_CONFIG.day
: daySelector.value

daySelector.value = initialDay

loadDay(initialDay).then(()=>{

if(TESTING_CONFIG.enabled){
updateMobileRouteButton()
updateTestingSummary()

if(TESTING_CONFIG.autoGenerateOnLoad){
runRandomTestingScenario({
day: initialDay
})
}

return
}

loadRouteFromURL()
updateMobileRouteButton()
})

})
