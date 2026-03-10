let walkingTime = 3
let shows = []
let selectedShows = []
let stageOrder = []

const walkingTimeSelector = document.getElementById("walkingTimeSelector")
const routeResult = document.getElementById("routeResult")
const daySelector = document.getElementById("daySelector")
const artistSearch = document.getElementById("artistSearch")


walkingTimeSelector.onchange = (e)=>{

walkingTime = Number(e.target.value)

generateRoute()

}

async function loadDay(day){

const response = await fetch(`data/${day}.json`)
const data = await response.json()

stageOrder = data.stageOrder

shows = data.shows.map(s => ({
  ...s,
  priority: 2
}))
selectedShows = []

renderLineup()

}

function renderLineup(){

const container = document.getElementById("lineupGrid")
container.innerHTML=""

const stages = stageOrder.filter(stage =>
shows.some(show => show.stage === stage)
)

const timelineStart=13*60
const timelineEnd=24*60
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

const hours=Math.floor(t/60)
const mins=t%60

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

const header=document.createElement("div")
header.className="stage-header"
header.innerText=stage

stageCol.appendChild(header)

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
<div class="priority">${"⭐".repeat(show.priority || 2)}</div>
`

div.onclick=()=>toggleShow(show,div)

div.oncontextmenu = (e)=>{

e.preventDefault()

show.priority++

if(show.priority>3){
show.priority=1
}

div.querySelector(".priority").innerText="⭐".repeat(show.priority)

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
}

function timeToMinutes(time){

const [h,m] = time.split(":").map(Number)
return h*60+m

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

function cannotReachNext(showA, showB){

if(showA.stage === showB.stage){
return false
}

const endA = timeToMinutes(showA.end)
const startB = timeToMinutes(showB.start)

return endA + walkingTime > startB

}

function generateRoute(){

const candidates=[...selectedShows]

candidates.sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start))

let bestRoute=[]
let bestScore=0

function explore(route,index,score){

if(index>=candidates.length){

if(score>bestScore){
bestScore=score
bestRoute=[...route]
}

return
}

const show=candidates[index]

// opción 1: saltar
explore(route,index+1,score)

// opción 2: ver show
let minutes=timeToMinutes(show.end)-timeToMinutes(show.start)

if(route.length>0){

const prev=route[route.length-1]

minutes=visibleMinutes(prev,show)

}

if(minutes>0){

const startNext=timeToMinutes(show.start)
const endNext=timeToMinutes(show.end)

let arrival=startNext

if(route.length>0){

const prev=route[route.length-1]

let walk = 0
if(prev.stage !== show.stage){
walk = walkingTime
}

// hora a la que debemos salir del show anterior
const leavePrev = timeToMinutes(show.start) - walk

const prevPriority = prev.priority || 2
const nextPriority = show.priority || 2

if(prev.stage !== show.stage){

if(nextPriority >= prevPriority){

if(prev.endReal > leavePrev){
prev.endReal = leavePrev
}

}else{

arrival = prev.endReal + walkingTime

}

}

arrival = prev.endReal + walk

}

const startReal=Math.max(arrival,startNext)

const visible=endNext-startReal

route.push({
...show,
startReal:startReal,
endReal:startReal+visible
})

explore(
route,
index+1,
score + showScore(minutes,show)
)

route.pop()

}

}

explore([],0,0)

displayRoute(bestRoute)
markRouteOnGrid(bestRoute)

}

function displayRoute(route){

routeResult.innerHTML=""

route.forEach((show,index)=>{

if(index>0){

const prev=route[index-1]

if(prev.stage!==show.stage){

const walk=document.createElement("div")
walk.className="walk"
walk.innerText=`↓ caminar ${walkingTime} min hacia ${show.stage}`

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

const startH=Math.floor(start/60)
const startM=(start%60).toString().padStart(2,"0")

const endH=Math.floor(end/60)
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

function clearSelection(){

selectedShows = []

const allShows = document.querySelectorAll(".show")

allShows.forEach(el => {

el.classList.remove("selected")
el.classList.remove("conflict")
el.classList.remove("route")

})

routeResult.innerHTML = ""

}

function checkConflicts(){

const allShows = document.querySelectorAll(".show")

// limpiar estados
allShows.forEach(el=>{
el.classList.remove("conflict")
})

// comparar todos los shows seleccionados
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
})

route.forEach(show=>{

const elements=document.querySelectorAll(".show")

elements.forEach(el=>{

if(
el.dataset.artist===show.artist &&
el.dataset.start===show.start &&
el.dataset.stage===show.stage
){
el.classList.add("route")
}

})

})

}

async function handleArtistSearch(){

const query = artistSearch.value.toLowerCase().trim()

if(query.length < 2){

const allShows = document.querySelectorAll(".show")

allShows.forEach(el=>{
el.classList.remove("search-hit")
})

return
}

// buscar en shows cargados
const matches = shows.filter(show =>
show.artist.toLowerCase().includes(query)
)

highlightSearchResults(matches)

// si no está en este día buscar en otros
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

function shareRoute(){

const routeData = {
day: daySelector.value,
walkingTime: walkingTime,
shows: selectedShows
}

const encoded = btoa(JSON.stringify(routeData))

const url = `${window.location.origin}${window.location.pathname}?route=${encoded}`

navigator.clipboard.writeText(url)

alert("Link copiado al portapapeles")

}

function loadRouteFromURL(){

const params = new URLSearchParams(window.location.search)
const route = params.get("route")

if(!route) return

try{

const data = JSON.parse(atob(route))

walkingTime = data.walkingTime
daySelector.value = data.day

loadDay(data.day).then(()=>{

data.shows.forEach(show=>{

const el = document.querySelector(
`.show[data-artist="${show.artist}"][data-start="${show.start}"][data-stage="${show.stage}"]`
)

if(el){

toggleShow(show, el)

}

})

})

}catch(e){

console.error("Error loading route", e)

}

}

document.getElementById("clearSelection").onclick = clearSelection
document.getElementById("generateRoute").onclick=generateRoute
document.getElementById("shareRoute").onclick = shareRoute
daySelector.onchange=()=>loadDay(daySelector.value)
artistSearch.addEventListener("input", handleArtistSearch)
artistSearch.addEventListener("keydown", (e)=>{
if(e.key === "Escape"){
artistSearch.value=""
renderLineup()
}
})

loadDay(daySelector.value).then(()=>{
loadRouteFromURL()
})
