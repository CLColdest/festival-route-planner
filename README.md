# Festival Route Planner

Aplicación web estática para planificar recorridos dentro de un festival usando horarios, escenarios, prioridades y tiempos de caminata entre shows.

Actualmente está orientada a lineups como `Lollapalooza Chile 2026`, pero la estructura permite reutilizarla con otros festivales cargando nuevos archivos JSON.

## Qué hace la app

- Muestra el lineup por día en una grilla por escenarios y horarios.
- Permite seleccionar shows y asignar prioridad con estrellas.
- Calcula una ruta recomendada según solapes, caminata y modo de planificación.
- Ofrece dos modos de cálculo:
  - `Estricto`: prioriza los shows más importantes y evita dividir bloques.
  - `Flexible`: acepta más cambios y splits para intentar ver más artistas.
- Permite compartir la ruta mediante:
  - enlace editable,
  - imagen del lineup con la ruta marcada,
  - acceso rápido a compartir por Instagram DM y Facebook.
- Incluye previews de artistas con Spotify usando una base JSON generada previamente.
- Tiene modo oscuro y modo claro.

## Cómo se usa

### Flujo básico

1. Selecciona un día.
2. Marca los shows que te interesan haciendo click.
3. Ajusta la prioridad:
   - Desktop: click derecho
   - Móvil: mantener presionado
4. Elige el tiempo de caminata entre escenarios.
5. Usa el switch para cambiar entre `Estricto` y `Flexible`.
6. Pulsa `Generar ruta` o `Recalcular ruta`.

### Controles importantes

- Click en un show: selecciona el artista y abre su preview.
- Click derecho o long press: cambia la cantidad de estrellas.
- Cuando ya existe una ruta calculada:
  - los shows marcados no se eliminan con un click accidental,
  - primero se arma una pequeña `X`,
  - y solo esa `X` los quita de la selección.

## Modos de ruta

### Modo Estricto

Pensado para ver la mayor cantidad posible de minutos de los shows más importantes.

Reglas generales:

- La prioridad domina: `⭐⭐⭐ > ⭐⭐ > ⭐`
- Si dos shows se solapan, gana el de mayor prioridad.
- No divide bloques.
- Considera tiempo de caminata obligatorio.
- Puede cortar un show para asegurar la llegada a uno más importante después.

### Modo Flexible

Pensado para ver más artistas aunque implique cambiar más veces o dividir bloques.

Reglas generales:

- Sigue respetando prioridades.
- Puede dividir shows de prioridad similar.
- Permite más movimiento entre escenarios.
- Aplica tiempos mínimos para que un split tenga sentido.
- Rebalancea rutas para evitar patrones tipo `A → B → A → B`.

## Preview de artistas

La app no consulta Spotify en tiempo real desde producción. En su lugar:

- usa un archivo estático `data/spotify-preview.json`,
- generado localmente a partir de la API de Spotify,
- y resuelto con overrides manuales para casos ambiguos.

Esto permite:

- servir la app en GitHub Pages sin backend,
- evitar login de Spotify para los usuarios,
- y mantener previews rápidos y consistentes.

## Compartir la ruta

Los botones de compartir se habilitan solo cuando existe una ruta generada.

Opciones disponibles:

- `Imagen`: genera un PNG del lineup completo con la ruta marcada.
- `Enlace`: copia una URL comprimida que conserva selección y prioridades.
- `Instagram`: copia el link y abre DM de Instagram.
- `Facebook`: abre el share dialog con el enlace actual.

## Estructura del proyecto

```text
festival-route-planner/
├─ app.js
├─ index.html
├─ styles.css
├─ data/
│  ├─ friday.json
│  ├─ saturday.json
│  ├─ sunday.json
│  ├─ spotify-preview.json
│  └─ spotify-artist-overrides.json
├─ img/
└─ scripts/
   └─ build-spotify-preview.mjs
```

## Formato de datos

Cada día se define en un JSON con esta estructura base:

```json
{
  "festival": "Lollapalooza Chile 2026",
  "stageOrder": ["Cenco Malls", "Banco de Chile", "Alternative"],
  "day": "Friday",
  "shows": [
    {
      "artist": "Interpol",
      "stage": "Banco de Chile",
      "start": "19:00",
      "end": "20:00"
    }
  ]
}
```

Campos esperados por show:

- `artist`
- `stage`
- `start`
- `end`

La prioridad se asigna en runtime desde la interfaz.

## Ejecutar localmente

Como es una app estática, no necesita build.

Puedes abrirla con cualquier servidor simple. Ejemplos:

### Opción 1: Live Server en VS Code

- Abre la carpeta del proyecto.
- Ejecuta `Open with Live Server` sobre `index.html`.

### Opción 2: Python

```powershell
python -m http.server 5000
```

Luego abre:

```text
http://127.0.0.1:5000/
```

## Generar la base de previews de Spotify

El archivo `data/spotify-preview.json` se genera localmente con un script de Node usando Spotify Web API.

### Variables necesarias

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

### Ejemplo en PowerShell

```powershell
$env:SPOTIFY_CLIENT_ID="tu_client_id"
$env:SPOTIFY_CLIENT_SECRET="tu_client_secret"
node scripts/build-spotify-preview.mjs
```

### Qué hace el script

- lee los artistas de `friday.json`, `saturday.json` y `sunday.json`,
- busca perfiles en Spotify,
- obtiene tracks relevantes,
- aplica overrides manuales cuando hace falta,
- y genera `data/spotify-preview.json`.

### Overrides manuales

Los casos ambiguos o especiales se resuelven en:

[`data/spotify-artist-overrides.json`](./data/spotify-artist-overrides.json)

Ejemplos:

- artistas con nombre distinto en Spotify,
- proyectos dobles o colaboraciones,
- artistas que se deben omitir,
- casos donde conviene fijar el `spotifyArtistId` manualmente.

## Testing

La app incluye un modo de testing aleatorio para generar selecciones automáticamente y estresar el algoritmo.

Se controla desde `TESTING_CONFIG` en:

[`app.js`](./app.js)

Ejemplo:

```js
const TESTING_CONFIG = {
  enabled: true,
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
```

Si `enabled: true`, aparece un botón para generar tests random desde la interfaz.

## Logs y depuración

La app incluye logs de depuración en consola para selección, UI y cálculo de rutas.

Prefijos útiles:

- `[STRICT]`
- `[FLEX]`
- `[UI]`
- `[SELECT]`
- `[PREVIEW]`
- `[TEST]`

Se controlan principalmente desde:

```js
const ROUTE_DEBUG = true
```

## Publicación

El proyecto se puede publicar directamente en GitHub Pages porque:

- no depende de backend,
- los previews de Spotify ya vienen pre-generados,
- y toda la lógica corre en frontend.

Flujo típico:

```powershell
git add .
git commit -m "Update route planner"
git push
```

## Estado actual

La app hoy incluye:

- planificación por prioridades,
- protección contra deselección accidental,
- share por imagen y enlace,
- previews de Spotify,
- modo oscuro,
- testing random,
- y una base preparada para seguir afinando el algoritmo de ruta.
