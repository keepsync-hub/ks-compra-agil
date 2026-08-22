(function () {
  var filas = [];
  try { filas = JSON.parse(atob(document.getElementById('__data').textContent)); } catch (e) { filas = []; }

  var GLOSA = {
    nuevo: ['Sin revisar', ''], cotizando: ['Cotizando…', 'warn'], generando: ['Generando…', 'warn'],
    cotizado: ['Cotizado', 'ok'], sin_ficha: ['Falta la ficha del curso', 'bad'],
    avanzar: ['Avanzando', 'ok'], rechazado: ['Rechazado', 'bad'], error: ['Con error', 'bad']
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function clp(n) { return n ? '$' + Number(n).toLocaleString('es-CL') : '—'; }
  function banda(s) { return s >= 75 ? 'ok' : s >= 60 ? 'warn' : 'bad'; }

  function dias(cierre) {
    if (!cierre) return null;
    var d = new Date(String(cierre).replace(' ', 'T'));
    if (isNaN(d)) return null;
    return Math.ceil((d - new Date()) / 86400000);
  }

  function aviso(t) {
    var m = document.getElementById('msg');
    m.textContent = t; m.style.display = 'block';
    clearTimeout(m._t); m._t = setTimeout(function () { m.style.display = 'none'; }, 6000);
  }

  function post(ruta, cuerpo) {
    return fetch(ruta, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().catch(function () { return {}; });
    });
  }

  function tarjeta(f) {
    var g = GLOSA[f.estado] || [f.estado || 'Sin revisar', ''];
    var d = dias(f.fechaCierre);
    var docs = [];
    try { docs = JSON.parse(f.documentosJson || '[]'); } catch (e) { docs = []; }
    var obs = {};
    try { obs = JSON.parse(f.observacionesJson || '{}'); } catch (e) { obs = {}; }

    var h = '<article class="card" data-codigo="' + esc(f.codigo) + '">';

    if (f.scoreApertura != null && f.scoreApertura !== '') {
      h += '<div class="score-row"><div><span class="score ' + banda(f.scoreApertura) + '">' +
        esc(f.scoreApertura) + '%</span><span class="score-l">apertura</span></div>' +
        '<div class="sub" style="font-size:.78rem">Cuánto de la admisibilidad sigue sin resolver. ' +
        'No es una probabilidad de adjudicación.</div></div>';
    }

    h += '<span class="codigo">' + esc(f.codigo) + '</span>' +
      '<span class="org">' + esc(f.organismo) + '</span>' +
      '<span class="nombre">' + esc(f.nombre) + '</span>';

    h += '<div class="chips"><span class="badge ' + g[1] + '">' + esc(g[0]) + '</span>';
    if (d !== null) {
      h += '<span class="badge ' + (d <= 1 ? 'bad' : d <= 3 ? 'warn' : 'ok') + '">' +
        (d < 0 ? 'Cerrada' : d === 0 ? 'Cierra hoy' : 'Quedan ' + d + ' día(s)') + '</span>';
    }
    if (f.catalogoProvisional) {
      h += '<span class="badge warn">Lista de documentos provisional</span>';
    }
    h += '</div>';

    h += '<dl><dt>Tope</dt><dd>' + clp(f.topeClp) + '</dd>';
    if (f.totalClp) {
      h += '<dt>Valor ofertado</dt><dd><strong>' + clp(f.totalClp) + '</strong>' +
        (f.descuentoPct ? ' · ' + f.descuentoPct + '% bajo el tope' : '') + '</dd>';
    }
    h += '<dt>Cierre</dt><dd>' + esc(f.fechaCierre) + '</dd>';
    if (docs.length) h += '<dt>Documentos</dt><dd>' + docs.length + '</dd>';
    h += '</dl>';

    if (obs.pendientes && obs.pendientes.length) {
      h += '<details><summary>Observaciones antes de presentar (' + obs.pendientes.length + ')</summary><ul>';
      for (var i = 0; i < obs.pendientes.length; i++) h += '<li>' + esc(obs.pendientes[i]) + '</li>';
      h += '</ul></details>';
    }
    if (f.ultimoError) {
      h += '<details><summary>Último error</summary><ul><li>' + esc(f.ultimoError) + '</li></ul></details>';
    }

    h += '<div class="cta">';
    if (f.estado !== 'cotizando' && f.estado !== 'generando') {
      h += '<button class="btn sec" data-accion="cotizar">Cotizar</button>';
    }
    if (f.pdfUrl) {
      h += '<a class="btn sec" href="https://keepsync-hub.github.io/ks-compra-agil/' +
        esc(f.pdfUrl) + '">Ver borrador</a>';
    }
    if (f.estado !== 'avanzar') h += '<button class="btn ok" data-accion="avanzar">Avanzar</button>';
    if (f.estado !== 'rechazado') h += '<button class="btn bad" data-accion="rechazar">Rechazar</button>';
    if (f.estado === 'avanzar' && f.driveFolderId) {
      h += '<a class="btn" href="mp/expediente?codigo=' + encodeURIComponent(f.codigo) +
        '">Expediente y documentos</a>';
    }
    h += '<a class="btn sec" href="' + esc(f.urlPortal) + '">Ficha en el portal</a>';
    h += '</div></article>';
    return h;
  }

  function pintar() {
    var g = document.getElementById('grid');
    if (!filas.length) {
      g.innerHTML = '<p class="vacio">No hay Compras Ágiles registradas todavía. ' +
        'Corré el radar para poblar la tabla.</p>';
      return;
    }
    var h = '';
    for (var i = 0; i < filas.length; i++) h += tarjeta(filas[i]);
    g.innerHTML = h;
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-accion]');
    if (!b) return;
    var codigo = b.closest('.card').getAttribute('data-codigo');
    var accion = b.getAttribute('data-accion');
    b.disabled = true;

    if (accion === 'cotizar') {
      post('mp/cotizar', { codigo: codigo }).then(function () {
        aviso('Cotización pedida para ' + codigo + '. Tarda unos minutos; recargá para ver el resultado.');
      }).catch(function (e) { aviso('No se pudo: ' + e.message); b.disabled = false; });
      return;
    }

    var motivo = '';
    if (accion === 'rechazar') {
      motivo = prompt('¿Por qué se descarta ' + codigo + '? (queda registrado)') || '';
    }
    post('mp/decision', { codigo: codigo, decision: accion, motivo: motivo }).then(function (r) {
      aviso(accion === 'avanzar'
        ? 'Listo: se creó el árbol de carpetas en Drive para ' + codigo + '.'
        : codigo + ' quedó descartada.');
      setTimeout(function () { location.reload(); }, 1200);
    }).catch(function (e) { aviso('No se pudo: ' + e.message); b.disabled = false; });
  });

  document.getElementById('btn-radar').addEventListener('click', function () {
    var b = this; b.disabled = true;
    document.getElementById('estado-corrida').textContent = 'Pidiendo la corrida…';
    fetch('mp/radar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (r) {
      if (r && r.espera) {
        document.getElementById('estado-corrida').textContent = r.espera;
        b.disabled = false;
        return;
      }
      document.getElementById('estado-corrida').textContent =
        'Corrida pedida. El radar tarda unos minutos; recargá esta página después.';
    }).catch(function (e) {
      document.getElementById('estado-corrida').textContent = 'No se pudo: ' + e.message;
      b.disabled = false;
    });
  });

  pintar();
})();
