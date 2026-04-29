// ─── Configuración ────────────────────────────────────────────────────────────
const SHEET_CRUDO_E     = 'crudo';
const SHEET_OBJETIVOS_E = 'objetivos';
const SHEET_CLIENTES_E  = 'cuentas';

const EXPORT_EMAIL   = 'fran@frandelcasal.com';
const EXPORT_DAYS    = 30; // días hacia atrás a incluir

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sheetToObjectsE(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { headers: [], rows: [] };
  const headers = data[0].map(h => String(h).trim());
  const rows = data.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
  return { headers, rows };
}

function toDateOnlyE(val) {
  if (!val) return null;
  const d = val instanceof Date ? new Date(val) : new Date(val);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function rowToCSVLine(headers, row) {
  return headers.map(h => {
    const val = row[h] !== undefined ? String(row[h]) : '';
    // Escapar comillas y envolver en comillas si tiene coma, comilla o salto de línea
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  }).join(',');
}

function buildCSV(headers, rows) {
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(rowToCSVLine(headers, r)));
  return lines.join('\n');
}

// ─── Función principal ────────────────────────────────────────────────────────
function exportarCSVsPorEspecialista() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const { headers: crudoHeaders, rows: crudoRows } = sheetToObjectsE(ss.getSheetByName(SHEET_CRUDO_E));
  const { rows: objetivosRows } = sheetToObjectsE(ss.getSheetByName(SHEET_OBJETIVOS_E));
  const { rows: clientesRows }  = sheetToObjectsE(ss.getSheetByName(SHEET_CLIENTES_E));

  // Mapa accountId → nombre cliente
  const clientesMap = {};
  clientesRows.forEach(r => {
    const id   = String(r['cuenta publicitaria'] || '').trim();
    const name = String(r['cliente'] || id).trim();
    if (id) clientesMap[id] = name;
  });

  // Filtrar crudo: últimos EXPORT_DAYS días
  const now    = new Date();
  now.setHours(0, 0, 0, 0);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - EXPORT_DAYS);

  const recentRows = crudoRows.filter(r => {
    const d = toDateOnlyE(r['Date']);
    return d && d >= cutoff;
  });

  Logger.log(`Filas en los últimos ${EXPORT_DAYS} días: ${recentRows.length}`);

  // Agrupar cuentas por especialista desde objetivos-dashboard
  const especialistas = {}; // nombre → Set de accountIds
  objetivosRows.forEach(r => {
    const especialista = String(r['especialista'] || '').trim().toLowerCase();
    const accountId    = String(r['cuenta publicitaria'] || '').trim();
    const metaActiva   = String(r['meta ads activa'] || '').trim().toLowerCase();
    if (!especialista || !accountId || metaActiva === 'no') return;
    if (!especialistas[especialista]) especialistas[especialista] = new Set();
    especialistas[especialista].add(accountId);
  });

  Logger.log(`Especialistas encontrados: ${Object.keys(especialistas).join(', ')}`);

  // Armar adjuntos agrupados por especialista
  const attachments = [];
  let totalCSVs = 0;

  Object.entries(especialistas).forEach(([especialista, cuentas]) => {
    cuentas.forEach(accountId => {
      const filas = recentRows.filter(r => String(r['Account ID']).trim() === accountId);
      if (!filas.length) {
        Logger.log(`Sin datos recientes: ${especialista} / ${accountId}`);
        return;
      }

      const nombreCliente = clientesMap[accountId] || accountId;
      const csvContent    = buildCSV(crudoHeaders, filas);
      const fileName      = `${especialista}_${nombreCliente.replace(/\s+/g, '-').toLowerCase()}_${accountId}.csv`;

      attachments.push(Utilities.newBlob(csvContent, 'text/csv', fileName));
      Logger.log(`CSV armado: ${fileName} (${filas.length} filas)`);
      totalCSVs++;
    });
  });

  if (!attachments.length) {
    Logger.log('No hay datos para exportar.');
    return;
  }

  // Armar cuerpo del mail con el resumen
  const fechaDesde = cutoff.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
  const fechaHasta = new Date(now - 86400000).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });

  let resumenHTML = '<ul style="font-size:14px;line-height:1.8">';
  Object.entries(especialistas).forEach(([especialista, cuentas]) => {
    const cuentasConDatos = [...cuentas].filter(id =>
      recentRows.some(r => String(r['Account ID']).trim() === id)
    );
    if (!cuentasConDatos.length) return;
    resumenHTML += `<li><strong>${especialista.charAt(0).toUpperCase() + especialista.slice(1)}</strong>: `;
    resumenHTML += cuentasConDatos.map(id => clientesMap[id] || id).join(', ');
    resumenHTML += '</li>';
  });
  resumenHTML += '</ul>';

  const htmlBody = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#131B34">
      <h2 style="margin:0 0 6px">Exportacion de datos · Meta Ads</h2>
      <p style="color:#666;font-size:14px;margin:0 0 16px">
        Datos del <strong>${fechaDesde}</strong> al <strong>${fechaHasta}</strong> — ${totalCSVs} archivo${totalCSVs !== 1 ? 's' : ''} adjunto${totalCSVs !== 1 ? 's' : ''}.
      </p>
      ${resumenHTML}
      <p style="color:#bbb;font-size:11px;margin-top:32px">
        FDC Digital · Exportacion automatica semanal
      </p>
    </div>`;

  const subject = `[EXPORT] Meta Ads · ${fechaDesde} al ${fechaHasta}`;

  GmailApp.sendEmail(EXPORT_EMAIL, subject, '', { htmlBody, name: 'FDC Digital', replyTo: 'fran@frandelcasal.com', attachments });
  Logger.log(`Mail enviado a ${EXPORT_EMAIL} con ${totalCSVs} CSVs adjuntos.`);
}
