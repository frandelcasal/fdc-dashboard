// ─── Configuración ────────────────────────────────────────────────────────────

const FROM_NAME_R    = 'FDC Digital';
const REPLY_TO_R     = 'fran@frandelcasal.com';
const DASHBOARD_BASE = 'https://fdc-dashboard.vercel.app/?account=';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sheetToObjectsR(sheet) {
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

function parseNumR(val) {
  if (val === null || val === undefined || val === '') return 0;
  return parseFloat(String(val).replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0;
}

function fmtPesos(n) {
  return '$' + Math.round(n).toLocaleString('es-AR');
}

function fmtRoasR(n) {
  return n.toFixed(2).replace('.', ',');
}

function fmtDiff(real, obj) {
  if (!obj) return '—';
  const pct = ((real - obj) / obj) * 100;
  const sign = pct >= 0 ? '+' : '';
  return sign + Math.round(pct) + '%';
}

// ─── Función principal ────────────────────────────────────────────────────────
function enviarResumenSemanal() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const dataRows    = sheetToObjectsR(ss.getSheetByName('crudo'));
  const targetsRows = sheetToObjectsR(ss.getSheetByName('objetivos'));
  const clientsRows = sheetToObjectsR(ss.getSheetByName('cuentas'));

  // Mes actual
  const now        = new Date();
  const yesterday  = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const year       = now.getFullYear();
  const month      = now.getMonth() + 1;
  const monthPad   = String(month).padStart(2, '0');
  const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const monthName  = monthNames[month - 1];
  const dateLabel  = yesterday.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

  // Filas del mes actual
  const monthRows = dataRows.filter(r => {
    const d = String(r['Date'] instanceof Date ? r['Date'].toISOString().slice(0,7) : r['Date']).slice(0,7);
    return d === `${year}-${monthPad}`;
  });

  let sent = 0;

  clientsRows.forEach(client => {
    const accountId = String(client['account_id'] || '').trim();
    const email     = String(client['email'] || '').trim();
    const nombre    = String(client['nombre'] || '').trim();
    const status    = String(client['status'] || '').trim().toLowerCase();

    if (!accountId || !email) return;
    if (status === 'inactiva') return;

    // Datos del mes para esta cuenta
    const rows = monthRows.filter(r => String(r['Account ID']).trim() === accountId);
    if (!rows.length) {
      Logger.log(`Sin datos este mes para ${nombre}, se omite.`);
      return;
    }

    const spent = rows.reduce((s, r) => s + parseNumR(r['Amount Spent']), 0);
    const sales = rows.reduce((s, r) => s + parseNumR(r['Website Purchases Conversion Value']), 0);
    const roas  = spent > 0 ? sales / spent : 0;

    // Objetivos del mes
    const monthNumStr  = monthPad;
    const monthNameStr = monthName;
    const target = targetsRows.find(t => {
      if (String(t['cuenta publicitaria'] || '').trim() !== accountId) return false;
      const mesVal = t['mes'];
      if (!mesVal) return false;
      // El campo mes puede ser un Date o un string
      if (mesVal instanceof Date) {
        return mesVal.getFullYear() === year && (mesVal.getMonth() + 1) === month;
      }
      const m = String(mesVal).trim().toLowerCase();
      return m === monthPad || m === String(month) || m === monthName;
    });

    const spentObj = target ? parseNumR(target['inversion obj'] || 0) : 0;
    const salesObj = target ? parseNumR(target['facturacion obj'] || 0) : 0;
    const roasObj  = target ? parseNumR(target['roas obj'] || 0) : 0;

    const dashboardUrl = DASHBOARD_BASE + accountId;

    // Armar mail
    const subject = `Tu resumen de campañas · ${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;

    const spentDiff = spentObj  ? fmtDiff(spent, spentObj)  : '—';
    const salesDiff = salesObj  ? fmtDiff(sales, salesObj)  : '—';
    const roasDiff  = roasObj   ? fmtDiff(roas,  roasObj)   : '—';

    const htmlBody = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#131B34">

        <p style="margin:0 0 20px;font-size:15px">Hola!</p>
        <p style="margin:0 0 24px;font-size:15px">
          Acá va el resumen de tus campañas de lo que va de <strong>${monthName.charAt(0).toUpperCase() + monthName.slice(1)}</strong> hasta ayer:
        </p>

        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
          <thead>
            <tr style="border-bottom:2px solid #131B34">
              <th style="padding:8px 0;text-align:left;font-weight:600"></th>
              <th style="padding:8px 12px;text-align:right;font-weight:600">Real</th>
              <th style="padding:8px 12px;text-align:right;font-weight:600">Objetivo</th>
              <th style="padding:8px 12px;text-align:right;font-weight:600">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px solid #e8e3da">
              <td style="padding:10px 0;font-weight:500">Inversion</td>
              <td style="padding:10px 12px;text-align:right">${fmtPesos(spent)}</td>
              <td style="padding:10px 12px;text-align:right;color:#888">${spentObj ? fmtPesos(spentObj) : '—'}</td>
              <td style="padding:10px 12px;text-align:right;font-weight:600;color:${spent >= spentObj && spentObj ? '#16a34a' : '#eb0000'}">${spentDiff}</td>
            </tr>
            <tr style="border-bottom:1px solid #e8e3da">
              <td style="padding:10px 0;font-weight:500">Ventas</td>
              <td style="padding:10px 12px;text-align:right">${fmtPesos(sales)}</td>
              <td style="padding:10px 12px;text-align:right;color:#888">${salesObj ? fmtPesos(salesObj) : '—'}</td>
              <td style="padding:10px 12px;text-align:right;font-weight:600;color:${sales >= salesObj && salesObj ? '#16a34a' : '#eb0000'}">${salesDiff}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;font-weight:500">ROAS</td>
              <td style="padding:10px 12px;text-align:right">${fmtRoasR(roas)}</td>
              <td style="padding:10px 12px;text-align:right;color:#888">${roasObj ? fmtRoasR(roasObj) : '—'}</td>
              <td style="padding:10px 12px;text-align:right;font-weight:600;color:${roas >= roasObj && roasObj ? '#16a34a' : '#eb0000'}">${roasDiff}</td>
            </tr>
          </tbody>
        </table>

        <p style="margin:0 0 24px">
          <a href="${dashboardUrl}" style="background:#131B34;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px">
            Ver mi dashboard completo
          </a>
        </p>

        <p style="color:#888;font-size:12px;margin:0">
          FDC Digital · Este resumen se envia todos los lunes automaticamente.
        </p>

      </div>`;

    GmailApp.sendEmail(email, subject, '', { htmlBody, name: FROM_NAME_R, replyTo: REPLY_TO_R });
    Logger.log(`Enviado a ${nombre} (${email})`);
    sent++;
  });

  Logger.log(`Resumen semanal completado. Mails enviados: ${sent}`);
}
