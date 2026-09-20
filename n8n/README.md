# Los workflows del panel, versionados

Los tres workflows del panel operativo viven acá como fuente, no como export: `panel.ts`,
`acciones.ts` y `carpetas-drive.ts`. Lo que corre en n8n se construye desde estos archivos.

## Por qué hay un paso de construcción

El SDK del builder de n8n acepta un subconjunto muy acotado de TypeScript —sin `import`, sin
`require`, sin funciones— así que el cuerpo de un nodo Code no puede leerse de un archivo. Se
escribe en `n8n/chunks/` y `construir.mjs` lo inyecta ya escapado donde el workflow dice
`__CHUNK:archivo.js__`:

```
node n8n/construir.mjs panel     # → n8n/build/panel.ts (gitignored)
```

La resolución es recursiva: un chunk puede incrustar otro.

## Publicar: nunca crear, siempre actualizar

```
1. node n8n/construir.mjs <nombre>
2. get_node_types de CADA nodo que se toque      ← no saltearlo, ver abajo
3. validate_workflow
4. update_workflow  sobre el workflowId EXISTENTE
5. publish_workflow
```

**Jamás `create_workflow_from_code` sobre los tres del panel.** Crearía workflows nuevos con URLs
de webhook nuevas, y con eso se rompen el botón de `docs/index.html`, el skill
`subir-documento-drive` y el dispatch de `.github/workflows/mp.yml`. Un workflow **nuevo y sin
webhook** sí se crea (así nació `KS · Cotización por correo` el 2026-09-20): no hay URL que romper
y el disparador es manual.

| Workflow | ID |
|---|---|
| MP · Panel | `6TTvRQZrzmrW3Oa6` |
| MP · Acciones | `wJbA7Fq4pHtUAwjz` |
| MP · Carpetas Drive | `do3woax6AGPYxEAN` |
| KS · Cotización por correo | `tyla40LSUSXQAIju` |
| Data Table `mp_solicitudes` | `hZ7iJZTkt01XfRUc` |

## El paso 2 no es burocracia

Dos de los tres bugs que tenían el panel muerto eran parámetros de nodo escritos de memoria:

- `Listar los archivos` pedía `fields: ['id','name']`, y `parents` **no está en el enum de `fields`**
  de ese nodo. `render-expediente.js` agrupa por `a.parents[0]`, así que descartaba todos los
  archivos y el expediente decía "Sin insumos" siempre. Va `['*']`.
- `Crear el árbol en Drive` emitía `workflowInputs: {mappingMode:'autoMapInputData', value:null}`.
  n8n corre `Object.keys(value)` al validar y la ejecución moría con *"Cannot convert undefined or
  null to object"*. Con un sub-workflow en `passthrough` ese parámetro **se omite**.

En los dos casos la muestra `output:` del nodo en la fuente declaraba lo que se esperaba, no lo que
el nodo devuelve. Una muestra escrita a mano no es una medición.

## Los chunks sí se pueden probar

`npm test` los corre fuera de n8n (`test/ayuda-chunks.ts` los ejecuta como los ejecuta n8n: el
archivo es el cuerpo de una función con `$json`, `$input` y `$()` inyectados). Es el único lugar
donde estos nueve archivos son ejecutables sin desplegar: no los ve el typecheck ni ningún import.
Un cambio en `n8n/chunks/` se prueba ahí antes de publicarlo.

Cobertura real, para no creerla más amplia de lo que es: **ocho de los nueve**. Tienen tests
`ingesta`, `cooldown`, `faltantes`, `pedido-drive`, `decision`, `query-hijos`, `render-expediente` y
`resumen-drive`. El único sin ninguno es **`render-panel.js`**.

Y `test/construir-workflows.test.ts` corre `construir.mjs` sobre los tres workflows: un marcador
`__CHUNK:` con typo o un chunk renombrado falla en `npm test` en vez de descubrirse al publicar.
También delata un chunk en disco que ningún workflow incrusta.

Ojo: un chunk corregido en el repo **no llega solo a producción**. Hay que publicarlo con el
procedimiento de arriba, con `setNodeParameter` sobre `/jsCode` del nodo Code que lo usa.

## Mandar una cotización por correo (`cotizacion-correo.ts`)

`KS · Cotización por correo` (`tyla40LSUSXQAIju`) manda un PDF de `output/` al cliente, con el
archivo adjunto. Existe porque **el MCP de Gmail no adjunta archivos**, y está acá y no en el panel
porque no comparte nada con él: disparador manual, sin webhook, sin Data Table.

El PDF no se sube a ningún lado: ya está versionado en el repo (`output/` se versiona a propósito)
y el nodo GitHub lo trae con `file:get` + `asBinaryProperty`, usando la **misma credencial OAuth2**
con la que el panel dispara `mp.yml`. Ojo con dos cosas al tocarlo:

- El nodo GitHub reemplaza el `json` del item por el del archivo, así que el asunto, el cuerpo y el
  destinatario se leen con `$('Datos del envío').first().json.…` y no con `$json`.
- `options.appendAttribution: false` en el nodo Gmail. Por defecto Gmail agrega *"This email was
  sent automatically with n8n"* al pie — dentro de una cotización formal a un cliente, no va.

Para mandar otra cotización se edita **solo** el nodo "Datos del envío" (destinatario, asunto,
cuerpo, ruta del PDF en el repo, rama). Primer envío real: `Q-20260920-KOMPU` a Kompu, 2026-09-20,
ejecución `653`, verificado en la casilla con el adjunto.
