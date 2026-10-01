#!/usr/bin/env sh
# Regenera la cotización ChatGPT Business de Alto Hospicio 3447-431-COT26 (correr desde la raíz del repo).
# --tc fija el dólar observado del día de emisión para que el PDF no cambie al regenerarlo.
npm run cotizar-suscripcion -- \
  --id=Q-20261001-AltoHospicio --titulo="ChatGPT Business (OpenAI) — Compra Ágil 3447-431-COT26" --slug=ChatGPTBusiness \
  --cliente="Municipalidad de Alto Hospicio" \
  "--linea=ChatGPT Business (asiento estándar, facturación anual)|20|4|12|OpenAI Help Center, Manage billing and seats in ChatGPT Business (help.openai.com/en/articles/8792536): asiento estándar USD 20/usuario/mes con facturación anual, mínimo 2 asientos; consultado 2026-10-01" \
  --salida=output/3447-431-COT26 --tope=6000000 \
  --tc=972.6 "--tc-fuente=mindicador.cl (dólar observado, 2026-10-01)" \
  --titular=cliente \
  --lamina=output/3447-431-COT26/lamina-cumplimiento-chatgpt-business.json \
  "--validez=Vigencia de esta cotización: 60 días corridos desde el cierre de la Compra Ágil (Art. 26). Valor total final en pesos chilenos, impuestos incluidos, fijo durante esa vigencia (Arts. 14 y 42)." \
  "--validez-corta=60 días corridos desde el cierre de la Compra Ágil (Art. 26)" \
  "--condicion=Plataforma ofertada: ChatGPT (OpenAI), plan ChatGPT Business, asiento estándar, modalidad de suscripción anual por 12 meses continuos; incluye ChatGPT Work y Codex, la referencia técnica del TDR (Arts. 10, 11 y 15)." \
  "--condicion=4 cuentas de usuario individualizadas en un workspace a nombre de la Municipalidad de Alto Hospicio, asociadas a los correos institucionales que determine la Unidad Técnica (Art. 11 e)." \
  "--condicion=Plazo de activación y habilitación de las 4 suscripciones: 30 días hábiles desde la aceptación de la Orden de Compra (Arts. 19 y 20)." \
  "--condicion=Ficha técnica y enlace oficial del fabricante: https://openai.com/business/pricing y https://help.openai.com/en/articles/8792536 (Art. 11 g)." \
  "--condicion=Contacto del ejecutivo responsable: Cristian Molina Espinoza — cristian.molina@keepsync.ai — +56 9 3674 8442 (Art. 15)."
