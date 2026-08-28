---
name: subir-documento-drive
description: Sube uno o más archivos locales (CV y certificados del relator/a, órdenes de compra, anexos ya rellenados a mano, cualquier acopio) a la carpeta de Google Drive de un documento del expediente, reutilizando los dos flujos de n8n que ya arma el panel operativo — nunca habla con Drive directamente. Usar cuando el usuario pida subir, adjuntar o cargar un archivo al expediente/carpeta de Drive de un código de Compra Ágil.
---

# Subir un documento al expediente de Drive

Sube archivos locales a la carpeta de Drive de un documento del expediente de una oferta, llamando
por HTTP a los **mismos dos flujos de n8n que ya usa el panel operativo** (`docs/panel/expediente.js`,
`n8n/workflows/panel.ts`, `n8n/workflows/acciones.ts`). No crea una vía nueva de escritura ni una
credencial de Drive: n8n sigue siendo el único componente que habla con Drive (ver "Panel operativo y
expediente de oferta" en `CLAUDE.md`). Este skill solo automatiza lo que un humano ya hace a mano en el
navegador — útil quien opera el panel desde una sesión de Claude Cowork, o para subir varios archivos
de una vez sin arrastrarlos uno por uno.

## Cuándo usar

- El usuario tiene un archivo local (título/CV/certificado del relator, una orden de compra anterior,
  un anexo `.docx`/`.pdf` ya completado a mano) y pide subirlo, adjuntarlo o cargarlo al expediente de
  un código de Compra Ágil (ej. `1618-67-COT26`).
- **No** usar para generar documentos — eso es `npm run generar-documento` (skill implícito en
  `src/scripts/generar-documento.ts`, ver la tabla de `TipoDocumento` en `src/lib/documentos-oferta.ts`).
  Este skill solo mueve bytes que ya existen en el disco hacia la carpeta correcta de Drive.

## Los dos flujos ya existentes que reutiliza

1. **`MP · Carpetas Drive`** (`n8n/workflows/carpetas-drive.ts`) crea, de forma idempotente
   (buscar-o-crear en cada nivel), el árbol `KeepSync - Mercado Público - Panchito / <codigo> —
   <organismo> / <NN - documento>` la primera vez que alguien pulsa **Avanzar** sobre una solicitud en
   el panel (`POST /mp/decision`, `n8n/workflows/acciones.ts`). Este skill **no crea carpetas**: si el
   documento pedido todavía no tiene `folderId`, se detiene y dice que hay que Avanzar la solicitud
   primero — crear carpetas por fuera de ese flujo duplicaría la lógica de idempotencia que ya existe
   ahí.
2. **`POST /mp/subir?folderId=<id>&nombre=<nombre>`** (`n8n/workflows/acciones.ts`, ruta `webSubir` →
   `subirArchivo`) sube un archivo (multipart, campo `data0`) a una carpeta de Drive por su id. Es
   exactamente la ruta que llama `docs/panel/expediente.js` al soltar un archivo en una "zona" de
   subida.

Para encontrar el `folderId` de un documento por su prefijo `NN` sin tener que abrir el panel a mano,
el script lee `GET /mp/expediente?codigo=<codigo>` — la misma página que arma
`n8n/chunks/render-expediente.js` — y decodifica el bloque `<script id="__data">` (JSON en base64) que
esa página ya le pasa a `expediente.js` para pintarse. No es un tercer flujo: es leer el mismo dato que
ya viaja al navegador.

## Por qué requiere la cookie de tu sesión del panel, y no un secreto nuevo

Las tres rutas de arriba están detrás del login propio de n8n (`authentication: 'n8nOAuth2'` en
`panel.ts`/`acciones.ts`), a propósito: escriben en el Drive real de la cuenta del usuario, igual que
`/mp/cotizar`, `/mp/generar` o `/mp/decision`. Ese gate es el mismo guardrail de fondo que el resto del
panel (que un humano autorice cada acción con efecto real), así que este script **no automatiza el
login ni lo rodea** — solo reutiliza, por HTTP, la sesión que ya abriste a mano en el navegador, igual
que `data/storageState.json` reutiliza una sesión de portal ya iniciada en otros skills de este repo.

## Requisitos

En `.env` (ver `.env.example`):

```
N8N_BASE_URL=https://keepsync-hub.app.n8n.cloud/webhook   # el mismo que usa postear-n8n.ts
N8N_PANEL_COOKIE=                                          # ver "Cómo conseguir la cookie" abajo
```

### Cómo conseguir la cookie

1. Iniciar sesión en el panel operativo (botón "Abrir el panel operativo" en `docs/index.html`).
2. Abrir las herramientas de desarrollador del navegador → pestaña Red (Network).
3. Recargar el panel o abrir cualquier expediente; buscar un request a `…/webhook/mp/…`.
4. Copiar el valor completo de la cabecera de request `Cookie` y pegarlo tal cual en
   `N8N_PANEL_COOKIE`.

La cookie expira cuando expira tu sesión de n8n — si el script empieza a fallar con 401/403, hay que
repetir estos cuatro pasos.

## Uso

```bash
# Por prefijo NN del documento (el mismo que usa el panel y generar-documento.ts):
npm run subir-documento -- 1618-67-COT26 --prefijo=03 "CV Juan Pérez.pdf" "Certificado Power BI.pdf"

# Directo por folderId de Drive (evita la consulta a /mp/expediente):
npm run subir-documento -- 1618-67-COT26 --folder-id=1AbCd... "orden-compra-anterior.pdf"
```

El prefijo `NN` de cada documento se ve en el expediente del panel (`/mp/expediente?codigo=…`) o en
`config/capacitaciones.json` → `documentos_obligatorios_oferta` del código correspondiente. Si el
prefijo no existe para ese código, el script lista los documentos válidos del expediente en vez de
adivinar uno.

## Guardrails

1. Nunca habla con la API de Drive directamente ni guarda una credencial de Drive: todo pasa por las
   rutas de n8n ya construidas y auditadas para este panel.
2. Nunca crea carpetas por su cuenta — si `folderId` es `null`, se detiene y pide que se use "Avanzar"
   en el panel primero.
3. La cookie nunca se imprime en los mensajes de error (se enmascara antes de loguear).
4. Este skill solo mueve archivos que ya existen; nunca inventa ni completa el contenido de un
   documento de tipo `acopio` (eso sigue siendo un guardrail de `documentos-oferta.ts`, no de este
   script).
