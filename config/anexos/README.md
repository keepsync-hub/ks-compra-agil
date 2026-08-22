# Plantillas de los anexos del organismo

Acá viven las dos piezas que necesita `npm run generar-documento` para rellenar un anexo
`tipo: "formulario"` **conservando el formato oficial** del organismo:

| Archivo | Qué es | Quién lo crea |
|---|---|---|
| `<slug>.docx` | El anexo en blanco del organismo, con marcadores `{campo}` escritos encima. | Una persona, **una sola vez por anexo**. |
| `<slug>.json` | Qué dato va en cada marcador (`MapaAnexo` en `src/lib/anexo-docx.ts`). | Se versiona junto con la plantilla. |

## Por qué hace falta el paso manual

Un `.docx` recién bajado del portal no tiene marcadores, y Word parte el texto en `<w:r>`
arbitrarios: "Razón social:" puede vivir repartido en tres nodos. Un buscar-y-reemplazar sobre el
XML crudo funciona hasta que el organismo reedita el archivo, y entonces falla **en silencio**,
dejando un anexo a medio llenar. Eso es causal de inadmisibilidad, no una observación.

Con la plantilla marcada el relleno es determinista y el diseño oficial queda intacto.

## Cómo crear una plantilla

1. Bajar el anexo en blanco. El radar ya lo deja en `data/<codigo>/attachments/`.
2. Abrirlo en Word o LibreOffice y **escribir `{campo}` donde va cada dato**, sin tocar nada más.
   Los nombres de campo son libres; tienen que calzar con las claves de `campos` en el `.json`.
3. Guardarlo como `config/anexos/<slug>.docx`.
4. Declarar el `slug` en `config/capacitaciones.json`, en el documento correspondiente:
   `{ "documento": "Anexo N°1 — …", "tipo": "formulario", "plantilla": "<slug>" }`.
5. Verificar que plantilla y mapa no se desincronizaron:
   `verificarMapaContraPlantilla("<slug>")` reporta marcadores sin mapear y al revés.

Una plantilla sirve para **todas** las Compras Ágiles que usen ese mismo anexo: los tres códigos de
Dipres (`1618-67/68/69-COT26`) comparten los Anexos N°1 y N°2.

## Mientras no exista la plantilla

`npm run generar-documento` **no improvisa un documento propio**: deja ese documento como
`bloqueado` y dice qué falta. Varias bases exigen su formato y un equivalente se rechaza en
admisibilidad, así que fallar visiblemente es mejor que entregar algo que parece correcto.
