// Freno de cuota. Cada corrida del radar barre todas las categorías activas, y el repo tiene un
// 429 documentado a las 9 requests (historico/cuota.jsonl). Sin esto, tres clics seguidos gastan
// tres corridas completas para el mismo resultado.
const MINUTOS = 15;

const conCorrida = $input.all()
  .map(i => i.json)
  .filter(f => f && f.corridaId && f.actualizado);

let ultima = null;
for (const f of conCorrida) {
  const t = new Date(f.actualizado).getTime();
  if (!isNaN(t) && (ultima === null || t > ultima)) ultima = t;
}

if (ultima === null) return [{ json: { disparar: true } }];

const minutos = (Date.now() - ultima) / 60000;
if (minutos >= MINUTOS) return [{ json: { disparar: true } }];

const faltan = Math.ceil(MINUTOS - minutos);
return [{ json: {
  disparar: false,
  espera: "La última corrida fue hace " + Math.floor(minutos) + " min. Esperá " + faltan +
    " min más: cada corrida gasta cuota de la API y no habría resultados nuevos.",
} }];
