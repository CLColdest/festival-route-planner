let walkingTime = 3
let shows = []
let selectedShows = []
let stageOrder = []
let routeGenerated = false
let previousSearchLength = 0
let lastScrolledShowId = null
let routeMode = "strict" 
const walkingTimeSelector = document.getElementById("walkingTimeSelector")
const routeResult = document.getElementById("routeResult")
const daySelector = document.getElementById("daySelector")
const artistSearch = document.getElementById("artistSearch")
const MIN_VISIBLE_MINUTES = 10
const MIN_SPLIT = 15


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

renderLineup()

}

function calculateRoute(){

if(routeMode === "strict"){
generateRoute()
}else{
generateRouteV2()
}

}

function renderLineup(){

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

div.dataset.artist=show.artist
div.dataset.start=show.start
div.dataset.stage=show.stage
div.dataset.priority = show.priority
div.title = "Click: seleccionar show\nClick derecho: cambiar prioridad"

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

div.onclick = ()=>{

if(longPressTriggered) return

toggleShow(show,div)

}
let pressTimer
let longPressTriggered = false

div.addEventListener("touchstart", ()=>{

longPressTriggered = false

pressTimer = setTimeout(()=>{

longPressTriggered = true

navigator.vibrate?.(40)

show.priority++

if(show.priority > 3){
show.priority = 0
}

div.querySelector(".priority").innerText = "⭐".repeat(show.priority)
div.dataset.priority = show.priority

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

show.priority++

if(show.priority > 3){
show.priority = 0
}

div.querySelector(".priority").innerText = "⭐".repeat(show.priority)

div.dataset.priority = show.priority

}

stageCol.appendChild(div)

})

container.appendChild(stageCol)

})

}

function toggleShow(show, element){

const index = selectedShows.findIndex(s =>
s.artist === show.artist &&
s.start === show.start &&
s.stage === show.stage
)

if(index !== -1){

selectedShows.splice(index,1)
element.classList.remove("selected")

}else{

selectedShows.push(show)
element.classList.add("selected")

}

console.log("Seleccionados:", selectedShows)
checkConflicts()
updateMobileRouteButton()
}

function timeToMinutes(time){

let [h,m] = time.split(":").map(Number)

if(h < 6){ // después de medianoche
h += 24
}

return h*60 + m

}

function visibleMinutes(prevShow,nextShow){

const endPrev=timeToMinutes(prevShow.end)

const startNext=timeToMinutes(nextShow.start)
const endNext=timeToMinutes(nextShow.end)

let arrival=endPrev

if(prevShow.stage!==nextShow.stage){
arrival+=walkingTime
}

const startReal=Math.max(arrival,startNext)

const visible=endNext-startReal

return Math.max(0,visible)

}

function showScore(minutes, show){

return minutes * (show.priority || 2)

}

function getShowDuration(show){

return timeToMinutes(show.end) - timeToMinutes(show.start)

}

function getShowScore(show){

const duration=timeToMinutes(show.end)-timeToMinutes(show.start)

return duration*(show.priority||1)

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

function generateRoute(){

console.log("=== GENERATE ROUTE STRICT ===")

console.log("Selected shows:")
selectedShows.forEach(s=>{
console.log(
s.artist,
s.start,
s.end,
"⭐".repeat(s.priority)
)
})

const allShows=document.querySelectorAll(".show")

allShows.forEach(el=>{
el.classList.remove("route")
el.classList.remove("rejected")
})

/* ordenar shows por inicio */

const sorted = [...selectedShows].sort(
(a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start)
)

let route = []
let currentTime = 0
let currentStage = null

for(const show of sorted){

console.log("Evaluating:", show.artist)

let start = timeToMinutes(show.start)
let end   = timeToMinutes(show.end)

/* aplicar caminata */

if(route.length > 0){

if(currentStage !== show.stage){

start = Math.max(start, currentTime + walkingTime)

}else{

start = Math.max(start, currentTime)

}

}else{

start = Math.max(start, currentTime)

}

/* calcular minutos visibles */

let visible = end - start

console.log(
show.artist,
"startReal:",start,
"end:",end,
"visible:",visible
)

if(visible < MIN_VISIBLE_MINUTES){

console.log("SKIPPING small visible:",show.artist)
continue

}

/* revisar conflicto con show anterior */

if(route.length > 0){

const prev = route[route.length-1]

const overlapStart = Math.max(start, prev.startReal)
const overlapEnd   = Math.min(end, prev.endReal)

const overlap = overlapEnd - overlapStart

if(overlap > 0){

const prPrev = Number(prev.priority)
const prCurr = Number(show.priority)

console.log(
"[CONFLICT]",
prev.artist,"⭐"+prPrev,
"vs",
show.artist,"⭐"+prCurr
)

/* gana el de mayor prioridad */

if(prPrev >= prCurr){

console.log("KEEP:",prev.artist)
continue

}else{

console.log("REPLACE:",prev.artist,"→",show.artist)

route.pop()

currentTime = prev.startReal
currentStage = prev.stage

start = Math.max(start, currentTime)

visible = end - start

if(visible < MIN_VISIBLE_MINUTES){
continue
}

}

}

}

/* agregar show completo */

console.log("ADDING:",show.artist)

route.push({
...show,
startReal:start,
endReal:end
})

currentTime = end
currentStage = show.stage

}

console.log("FINAL ROUTE:")

route.forEach(r=>{
console.log(r.artist,r.startReal,r.endReal)
})

displayRoute(route)
markRouteOnGrid(route)

routeGenerated = true
updateRouteButtonText()

}

function generateRouteV2(){

console.log("=== GENERATE ROUTE V2 DEBUG ===")

/* limpiar rutas visuales */

const allShows = document.querySelectorAll(".show")
allShows.forEach(el=>{
el.classList.remove("route")
el.classList.remove("rejected")
})

const candidateShows = [...selectedShows]

if(candidateShows.length === 0){
displayRoute([])
markRouteOnGrid([])
return
}

/* construir timeline */

let timestamps = new Set()

candidateShows.forEach(s=>{
timestamps.add(timeToMinutes(s.start))
timestamps.add(timeToMinutes(s.end))
})

timestamps = [...timestamps].sort((a,b)=>a-b)

console.log("[TIMELINE]",timestamps)

/* crear segmentos */

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

active.sort((a,b)=>Number(b.priority)-Number(a.priority))

segments.push({
shows: active,
start: segmentStart,
end: segmentEnd
})

}

/* construir ruta */

let route = []
let currentStage = null
let currentTime = 0

for(let i = 0; i < segments.length; i++){

const seg = segments[i]

let start = seg.start
let end = seg.end

let shows = seg.shows

console.log("\n[SEGMENT]",start,"-",end,shows.map(s=>`${s.artist} ⭐${s.priority}`))

let chosen = shows[0]

/* reglas de elección */

if(shows.length > 1){

const a = shows[0]
const b = shows[1]

const prA = Number(a.priority)
const prB = Number(b.priority)

console.log("[CANDIDATES]",a.artist,"⭐"+prA,"vs",b.artist,"⭐"+prB)

/* prioridades iguales */

if(prA === prB){

chosen = route.length % 2 === 0 ? a : b

console.log("[DECISION equal priority]",chosen.artist)

}

/* prioridad cercana */

else if(Math.abs(prA-prB) === 1){

const smaller = prA < prB ? a : b
const bigger  = prA < prB ? b : a

const availableStart = Math.max(start, currentTime)
const totalDuration = end - availableStart

const ratioSmaller = prA < prB
  ? prA / (prA + prB)
  : prB / (prA + prB)

const smallerDuration = Math.floor(totalDuration * ratioSmaller)

const mid = availableStart + smallerDuration

const firstDuration = smallerDuration
const secondDuration = end - mid

/* evitar splits muy pequeños */

if(firstDuration < MIN_SPLIT || secondDuration < MIN_SPLIT){

console.log("[NO SPLIT small block] choosing",bigger.artist)

chosen = bigger

}else{

console.log("[SPLIT close priority]")
console.log("first:",smaller.artist,"second:",bigger.artist)

segments.splice(i + 1, 0, {
shows:[bigger],
start:mid,
end:end
})

chosen = smaller
end = mid

}

}

}

/* aplicar walking */

if(currentStage && currentStage !== chosen.stage){

const walkStart = currentTime + walkingTime

console.log("[WALK]",currentStage,"→",chosen.stage,"arrive",walkStart)

start = Math.max(start, walkStart)

}else{

start = Math.max(start, currentTime)

}

if(end - start < MIN_VISIBLE_MINUTES){

console.log("[SKIP small segment]",chosen.artist)

continue

}

/* revisar show importante después */

let nextImportant = null

candidateShows.forEach(s=>{

if(s === chosen) return

const sStart = timeToMinutes(s.start)

if(sStart > start){

if(!nextImportant || sStart < timeToMinutes(nextImportant.start)){
nextImportant = s
}

}

})

if(nextImportant){

const nextStart = timeToMinutes(nextImportant.start)

if(Number(nextImportant.priority) > Number(chosen.priority)){

const safeExit = nextStart - walkingTime

if(safeExit < end){

console.log("[CUT for important]",chosen.artist,"→",safeExit)

end = safeExit

}

}

}


/* detectar patrón ABAB */

if(route.length >= 2){

const prev = route[route.length-1]
const prevPrev = route[route.length-2]

if(prevPrev.artist === chosen.artist && prev.artist !== chosen.artist){

console.log("[ABAB DETECTED]", prevPrev.artist, prev.artist)

/* artistas */

const artistA = prevPrev
const artistB = prev

/* calcular rango total */

const blockStart = artistA.startReal
const blockEnd   = end

const total = blockEnd - blockStart

/* pesos por estrellas */

const prA = Number(artistA.priority)
const prB = Number(artistB.priority)

const weightA = prA + 1
const weightB = prB + 1

const totalWeight = weightA + weightB

/* calcular split */

const timeA = Math.floor(total * (weightA / totalWeight))
const timeB = total - timeA

const newASplit = blockStart + timeA

console.log("[REBALANCE BLOCK]")
console.log("A:", artistA.artist, timeA, "min")
console.log("B:", artistB.artist, timeB, "min")

/* reescribir ruta */

artistA.endReal = newASplit

prev.startReal = newASplit + walkingTime
prev.endReal = blockEnd

/* evitar que agregue nuevo segmento */

continue

}

}

/* merge con segmento anterior */

let last = route[route.length-1]

if(last && last.artist === chosen.artist){

console.log("[MERGE]",chosen.artist)

last.endReal = end

}else{

console.log("[ADD]",chosen.artist,start,"-",end)

route.push({
...chosen,
startReal:start,
endReal:end
})

}

currentStage = chosen.stage
currentTime = end

}

console.log("\n=== FINAL ROUTE V2 ===")

route.forEach(r=>{
console.log(r.artist,r.startReal,"-",r.endReal)
})

displayRoute(route)
markRouteOnGrid(route)

routeGenerated = true
updateRouteButtonText()

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

if(routeGenerated){
btn.innerText = "🔄 Recalcular ruta"
}else{
btn.innerText = "⚡ Generar ruta"
}

}

function clearSelection(){

selectedShows = []

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
}

}

})

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

function overlaps(a,b){

const startA = timeToMinutes(a.start)
const endA = timeToMinutes(a.end)

const startB = timeToMinutes(b.start)
const endB = timeToMinutes(b.end)

return startA < endB && startB < endA

}

function buildConflictGroups(shows){

const groups=[]
const sorted=[...shows].sort(
(a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start)
)

sorted.forEach(show=>{

let overlappingGroups=[]

groups.forEach(group=>{
if(group.some(s=>overlaps(s,show))){
overlappingGroups.push(group)
}
})

if(overlappingGroups.length === 0){

groups.push([show])

}else{

const merged=[show]

overlappingGroups.forEach(g=>{
merged.push(...g)
})

/* eliminar grupos viejos */
overlappingGroups.forEach(g=>{
const index=groups.indexOf(g)
if(index>-1){
groups.splice(index,1)
}
})

groups.push(merged)

}

})

return groups

}

function resolveGroup(group){

return [...group].sort(
(a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start)
)

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

document.addEventListener("DOMContentLoaded", ()=>{

const clearBtn = document.getElementById("clearSelectionBtn")

if(clearBtn){
clearBtn.onclick = clearSelection
}

/* switch strict / flexible */

const modeSwitch = document.getElementById("routeModeSwitch")

modeSwitch.onclick = ()=>{

modeSwitch.classList.toggle("active")

routeMode = modeSwitch.classList.contains("active")
? "flexible"
: "strict"

showModeToast(routeMode)

if(selectedShows.length>0){
calculateRoute()
}

}

const mobileBtn = document.getElementById("generateRouteMobile")

if(mobileBtn){
mobileBtn.onclick = calculateRoute
}

const copyBtn = document.getElementById("copyLink")
const twitterBtn = document.getElementById("twitterShare")
const facebookBtn = document.getElementById("facebookShare")
const instagramBtn = document.getElementById("instagramShare")

copyBtn.onclick = () => {

const url = generateShareURL()

navigator.clipboard.writeText(url)

showToast("🔗 Link copiado al portapapeles")

}

twitterBtn.onclick = () => {

const url = encodeURIComponent(generateShareURL())

window.open(`https://twitter.com/intent/tweet?url=${url}`)

}

facebookBtn.onclick = () => {

const url = encodeURIComponent(generateShareURL())

window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`)

}

instagramBtn.onclick = () => {

const url = generateShareURL()

navigator.clipboard.writeText(url)

showToast("Instagram no permite compartir links directos. Se copió el link.")

}

daySelector.onchange = ()=>loadDay(daySelector.value)

artistSearch.addEventListener("input", handleArtistSearch)

artistSearch.addEventListener("keydown", (e)=>{
if(e.key === "Escape"){
artistSearch.value=""
renderLineup()
}
})

loadDay(daySelector.value).then(()=>{
loadRouteFromURL()
updateMobileRouteButton()
})

})
