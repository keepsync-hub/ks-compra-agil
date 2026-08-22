(function () {
  var d = {};
  try { d = JSON.parse(atob(document.getElementById('__data').textContent)); } catch (e) { d = {}; }
  var docs = d.documentos || [];

  var GLOSA_TIPO = {
    formulario: 'Formulario del organismo — se rellena su plantilla oficial',
    generable: 'Lo genera KeepSync desde los datos del TDR',
    acopio: 'Lo emite un tercero: solo puede subirse, generarlo sería falsificarlo'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function clp(n) { return n ? '$' + Number(n).toLocaleString('es-CL') : '—'; }

  function aviso(t) {
    var m = document.getElementById('msg');
    m.textContent = t; m.style.display = 'block';
    clearTimeout(m._t); m._t = setTimeout(function () { m.style.display = 'none'; }, 7000);
  }

  function estadoDoc(doc) {
    if (doc.listo) return ['ok', 'Listo'];
    if ((doc.archivos || []).length) return ['warn', 'Con insumos (' + doc.archivos.length + ')'];
    return ['bad', 'Sin insumos'];
  }

  function cabecera() {
    var listos = 0;
    for (var i = 0; i < docs.length; i++) if (docs[i].listo) listos++;
    var h = '<span class="codigo">' + esc(d.codigo) + '</span>' +
      '<span class="org"> · ' + esc(d.organismo) + '</span>' +
      '<h1>' + esc(d.nombre || d.curso || 'Expediente de oferta') + '</h1>' +
      '<p class="sub">Acá se juntan los antecedentes de cada documento exigido. ' +
      'Nada de esto se envía al portal: el envío final lo hace una persona.</p>' +
      '<div class="kpis">' +
      '<div class="kpi"><span class="v">' + listos + ' de ' + docs.length + '</span>' +
      '<span class="l">documentos listos</span></div>' +
      '<div class="kpi"><span class="v">' + clp(d.totalClp) + '</span><span class="l">valor ofertado</span></div>' +
      '<div class="kpi"><span class="v">' + clp(d.topeClp) + '</span><span class="l">tope del organismo</span></div>' +
      '<div class="kpi"><span class="v">' + esc(d.fechaCierre || '—') + '</span><span class="l">cierre</span></div>' +
      '</div>';
    if (d.driveFolderUrl) {
      h += '<p class="sub" style="margin-top:.8rem">' +
        '<a class="back" href="' + esc(d.driveFolderUrl) + '">Abrir la carpeta en Google Drive →</a></p>';
    }
    document.getElementById('cab').innerHTML = h;
  }

  function fila(doc) {
    var e = estadoDoc(doc);
    var h = '<section class="doc" data-prefijo="' + esc(doc.prefijo) + '">' +
      '<div class="doc-cab"><div>' +
      '<span class="doc-n">' + esc(doc.prefijo) + '</span> ' +
      '<span class="doc-t">' + esc(doc.documento) + '</span>' +
      '<div class="tipo">' + esc(GLOSA_TIPO[doc.tipo] || doc.tipo) + '</div>' +
      '</div><span class="badge ' + e[0] + '">' + e[1] + '</span></div>';

    if ((doc.archivos || []).length) {
      h += '<ul class="archivos">';
      for (var i = 0; i < doc.archivos.length; i++) {
        var a = doc.archivos[i];
        h += '<li>· <a href="https://drive.google.com/file/d/' + esc(a.id) + '/view">' +
          esc(a.name) + '</a></li>';
      }
      h += '</ul>';
    }
    if (doc.entregable) {
      h += '<ul class="archivos"><li>✓ Entregable: <a href="https://drive.google.com/file/d/' +
        esc(doc.entregable.id) + '/view">' + esc(doc.entregable.name) + '</a></li></ul>';
    }

    if (doc.folderId) {
      h += '<div class="zona" data-folder="' + esc(doc.folderId) + '">' +
        '<span>' + (doc.tipo === 'acopio'
          ? 'Subí acá el documento emitido por el tercero.'
          : doc.tipo === 'formulario'
            ? 'Subí acá el anexo en blanco del organismo y los antecedentes que pida.'
            : 'Subí acá cualquier insumo extra para este documento.') + '</span>' +
        '<input type="file" multiple>' +
        '<a class="btn sec" href="https://drive.google.com/drive/folders/' + esc(doc.folderId) +
        '">Ver carpeta</a></div>';
    } else {
      h += '<div class="zona">Esta carpeta todavía no existe en Drive. ' +
        'Volvé al panel y usá «Avanzar» para crear el árbol.</div>';
    }
    return h + '</section>';
  }

  function pintar() {
    cabecera();
    var h = '';
    for (var i = 0; i < docs.length; i++) h += fila(docs[i]);
    document.getElementById('docs').innerHTML = h ||
      '<p class="sub">No hay documentos registrados para esta oportunidad.</p>';

    var generables = 0, acopios = 0;
    for (var j = 0; j < docs.length; j++) {
      if (docs[j].tipo === 'acopio') acopios++; else generables++;
    }
    var nota = 'Generar produce los ' + generables + ' documento(s) que KeepSync puede armar ' +
      '(propuestas y anexos con plantilla).';
    if (acopios) {
      nota += ' Los otros ' + acopios + ' no se generan: son evidencia emitida por terceros ' +
        '(títulos, certificados, órdenes de compra) y hay que subirlos.';
    }
    if (d.catalogoProvisional) {
      nota += ' Ojo: la lista de documentos es PROVISIONAL — salió de la detección automática, ' +
        'no del TDR leído. Una carpeta faltante es causal de inadmisibilidad.';
    }
    document.getElementById('nota-generar').textContent = nota;
  }

  // Carga de archivos: multipart al webhook, que lo deja en la carpeta del documento en Drive.
  document.addEventListener('change', function (ev) {
    var input = ev.target;
    if (input.type !== 'file' || !input.files.length) return;
    var zona = input.closest('.zona');
    var folder = zona.getAttribute('data-folder');
    if (!folder) return;

    var pendientes = input.files.length;
    var fallos = 0;
    aviso('Subiendo ' + pendientes + ' archivo(s)…');

    for (var i = 0; i < input.files.length; i++) {
      (function (archivo) {
        var fd = new FormData();
        fd.append('data0', archivo, archivo.name);
        fetch('mp/subir?folderId=' + encodeURIComponent(folder) +
              '&nombre=' + encodeURIComponent(archivo.name), { method: 'POST', body: fd })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); })
          .catch(function () { fallos++; })
          .then(function () {
            pendientes--;
            if (pendientes === 0) {
              aviso(fallos ? fallos + ' archivo(s) no se pudieron subir.' : 'Listo. Recargando…');
              if (!fallos) setTimeout(function () { location.reload(); }, 1200);
            }
          });
      })(input.files[i]);
    }
  });

  ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var z = e.target.closest ? e.target.closest('.zona') : null;
      if (!z || !z.getAttribute('data-folder')) return;
      e.preventDefault();
      z.classList.toggle('sobre', ev === 'dragover');
      if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files.length) {
        var input = z.querySelector('input[type=file]');
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });

  document.getElementById('btn-generar').addEventListener('click', function () {
    var b = this; b.disabled = true;
    fetch('mp/generar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: d.codigo })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      aviso('Generación pedida. Tarda unos minutos; recargá esta página para ver los entregables.');
    }).catch(function (e) {
      aviso('No se pudo: ' + e.message);
      b.disabled = false;
    });
  });

  pintar();
})();
