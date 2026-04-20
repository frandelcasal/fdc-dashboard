// ─── Configuración ────────────────────────────────────────────────────────────
const SHEET_CRUDO    = 'crudo';
const SHEET_OBJETIVOS = 'objetivos-dashboard';
const SHEET_CLIENTES = 'aux';

const ALERT_EMAIL    = 'fran@frandelcasal.com';
const DAYS_THRESHOLD = 3;
const DASHBOARD_URL  = 'https://fdc-dashboard.vercel.app/admin.html';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

function parseNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  return parseFloat(String(val).replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0;
}

function toDateOnly(val) {
  if (!val) return null;
  const d = val instanceof Date ? new Date(val) : new Date(val);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Función principal ────────────────────────────────────────────────────────
function checkNoSalesAlerts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const dataRows    = sheetToObjects(ss.getSheetByName(SHEET_CRUDO));
  const targetsRows = sheetToObjects(ss.getSheetByName(SHEET_OBJETIVOS));
  const clientsRows = sheetToObjects(ss.getSheetByName(SHEET_CLIENTES));

  Logger.log(`Filas crudas: ${dataRows.length} | Objetivos: ${targetsRows.length} | Clientes: ${clientsRows.length}`);

  // 1. Cuentas excluidas de la alerta de ventas
  const noSalesAccounts = new Set();
  clientsRows.forEach(r => {
    const id = String(r['cuenta publicitaria'] || '').trim();
    if (id && String(r['sin ventas'] || '').trim().toLowerCase() === 'si') {
      noSalesAccounts.add(id);
    }
  });

  // 2. Mapa accountId → nombre legible
  const clientsMap = {};
  clientsRows.forEach(r => {
    const id   = String(r['cuenta publicitaria'] || '').trim();
    const name = String(r['cliente'] || '').trim();
    if (id) clientsMap[id] = name || id;
  });

  // 3. Cuentas activas (meta ads activa ≠ 'no')
  const activeAccounts = new Set();
  targetsRows.forEach(r => {
    const metaActive = String(r['meta ads activa'] || '').trim().toLowerCase();
    if (metaActive === 'no') return;
    const accountId = String(r['cuenta publicitaria'] || '').trim();
    if (accountId) activeAccounts.add(accountId);
  });

  Logger.log(`Cuentas activas: ${activeAccounts.size} | Excluidas de ventas: ${noSalesAccounts.size}`);

  // 4. Agrupar filas por Account ID
  const rowsByAccount = {};
  dataRows.forEach(r => {
    const id = String(r['Account ID'] || '').trim();
    if (!id) return;
    if (!rowsByAccount[id]) rowsByAccount[id] = [];
    rowsByAccount[id].push(r);
  });

  // 5. Fecha más reciente del dataset
  const allDates = dataRows.map(r => toDateOnly(r['Date'])).filter(Boolean);
  if (!allDates.length) {
    Logger.log('No hay datos en la pestaña crudo.');
    return;
  }
  const latestDate = new Date(Math.max(...allDates.map(d => d.getTime())));
  Logger.log(`Fecha más reciente en el dataset: ${latestDate.toDateString()}`);

  // 6. Evaluar cada cuenta activa
  const alerts = [];

  activeAccounts.forEach(accountId => {
    if (noSalesAccounts.has(accountId)) return;

    const rows = rowsByAccount[accountId] || [];
    if (!rows.length) return;

    const cutoff = new Date(latestDate);
    cutoff.setDate(cutoff.getDate() - (DAYS_THRESHOLD - 1));

    const recentRows = rows.filter(r => {
      const d = toDateOnly(r['Date']);
      return d && d >= cutoff && d <= latestDate;
    });

    if (!recentRows.length) return;

    const hasSales = recentRows.some(r => parseNum(r['Website Purchases']) > 0);
    if (hasSales) return;

    // Días desde la última venta
    const salesDates = rows
      .filter(r => parseNum(r['Website Purchases']) > 0)
      .map(r => toDateOnly(r['Date']))
      .filter(Boolean);

    let daysSinceLastSale;
    if (salesDates.length) {
      const lastSale = new Date(Math.max(...salesDates.map(d => d.getTime())));
      daysSinceLastSale = Math.round((latestDate - lastSale) / 86400000);
    } else {
      const firstDate = new Date(Math.min(...rows.map(r => toDateOnly(r['Date'])).filter(Boolean).map(d => d.getTime())));
      daysSinceLastSale = Math.round((latestDate - firstDate) / 86400000);
    }

    const name = clientsMap[accountId] || accountId;
    alerts.push({ name, accountId, days: daysSinceLastSale });
  });

  if (!alerts.length) {
    Logger.log('✅ Sin alertas de ventas hoy. No se envía mail.');
    return;
  }

  alerts.sort((a, b) => b.days - a.days);
  Logger.log(`🚨 ${alerts.length} cuenta(s) sin ventas: ${alerts.map(a => `${a.name} (${a.days}d)`).join(', ')}`);

  sendAlertEmail(alerts);
}

// ─── Email ────────────────────────────────────────────────────────────────────
function sendAlertEmail(alerts) {
  const count   = alerts.length;
  const subject = `[ALERTA] ${count} cuenta${count !== 1 ? 's' : ''} sin ventas · FDC Digital`;

  const rows = alerts.map(a => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #eee;font-weight:500">${a.name}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #eee;text-align:center;color:#eb0000;font-weight:700">${a.days} día${a.days !== 1 ? 's' : ''}</td>
    </tr>`).join('');

  const htmlBody = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#eb0000;margin:0 0 6px">Cuentas sin ventas registradas</h2>
      <p style="color:#666;margin:0 0 20px;font-size:14px">
        Las siguientes cuentas llevan <strong>${DAYS_THRESHOLD} o más días</strong> sin registrar compras.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f5f5f5">
            <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #ddd">Cuenta</th>
            <th style="padding:10px 14px;text-align:center;border-bottom:2px solid #ddd">Días sin ventas</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:24px">
        <a href="${DASHBOARD_URL}" style="background:#131B34;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px">
          Ver dashboard →
        </a>
      </p>
      <p style="color:#bbb;font-size:11px;margin-top:32px">
        FDC Digital · Alerta automática · ${new Date().toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' })}
      </p>
    </div>`;

  GmailApp.sendEmail(ALERT_EMAIL, subject, '', { htmlBody, name: 'FDC Digital', replyTo: 'fran@frandelcasal.com' });
  Logger.log(`📧 Mail enviado a ${ALERT_EMAIL}`);
}
