// ─── META ADS → GOOGLE SHEETS ────────────────────────────────────────────────
const META_VERSION   = 'v25.0';
const SHEET_CRUDO    = 'crudo';
const SHEET_CUENTAS  = 'cuentas';
const SHEET_MENSUAL  = 'mensual-cuentas';
const SHEET_ANUNCIOS = 'anuncios-mes';
const LOOKBACK_DAYS  = 60;  // días rolling para crudo
const ANUNCIOS_DAYS  = 60;  // días para anuncios-mes

// ─── Corre todo junto (para el trigger diario) ────────────────────────────────
function fetchAll() {
  fetchMetaAds();
  fetchMensualCuentas();
  fetchAnunciosMes();
}

// ─── Lee cuentas activas ──────────────────────────────────────────────────────
function getActiveAccounts() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CUENTAS);
  if (!sheet) throw new Error(`No existe la pestaña "${SHEET_CUENTAS}"`);
  return sheet.getDataRange().getValues()
    .slice(1)
    .filter(r => r[0] && String(r[2]).trim().toLowerCase() === 'activa')
    .map(r => String(r[0]).trim());
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CRUDO — diario por cuenta (últimos LOOKBACK_DAYS días)
// ═══════════════════════════════════════════════════════════════════════════════
function fetchMetaAds() {
  const token = PropertiesService.getScriptProperties().getProperty('META_ACCESS_TOKEN');
  if (!token) throw new Error('Falta META_ACCESS_TOKEN');

  const accountIds = getActiveAccounts();
  if (!accountIds.length) { Logger.log('⚠️ No hay cuentas activas'); return; }
  Logger.log(`📋 crudo: ${accountIds.length} cuentas...`);

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_CRUDO) || ss.insertSheet(SHEET_CRUDO);

  const HEADERS = ['Account ID','Date','Amount Spent',
    'Website Purchases Conversion Value','Impressions',
    'Inline Link Clicks','Website Purchases',
    '3 Seconds Video View','Landing Page Views'];
  if (sheet.getRange(1,1).getValue() !== 'Account ID')
    sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);

  const today = new Date();
  const since = new Date(today); since.setDate(since.getDate() - LOOKBACK_DAYS);
  const sinceStr = Utilities.formatDate(since, 'UTC', 'yyyy-MM-dd');
  const untilStr = Utilities.formatDate(today, 'UTC', 'yyyy-MM-dd');

  const existing = new Set(
    sheet.getDataRange().getValues().slice(1)
      .filter(r => r[0]).map(r => {
        const d = r[1] instanceof Date ? Utilities.formatDate(r[1], 'UTC', 'yyyy-MM-dd') : String(r[1]).slice(0, 10);
        return `${r[0]}_${d}`;
      })
  );

  let added = 0, errors = 0;
  const newRows = [];

  for (const id of accountIds) {
    try {
      const rows = fetchInsights(id, sinceStr, untilStr, token, '1', false);
      for (const row of rows) {
        const key = `${row[0]}_${row[1]}`;
        if (!existing.has(key)) { newRows.push(row); existing.add(key); }
      }
      Utilities.sleep(1000);
    } catch(e) {
      Logger.log(`⚠️ crudo/${id}: ${e.message}`); errors++;
      Utilities.sleep(2000);
    }
  }

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow()+1, 1, newRows.length, HEADERS.length).setValues(newRows);
    added = newRows.length;
  }
  Logger.log(`✅ crudo: ${added} filas nuevas | ⚠️ ${errors} errores`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. MENSUAL-CUENTAS — mensual por cuenta (desde ene 2026)
// ═══════════════════════════════════════════════════════════════════════════════
function fetchMensualCuentas() {
  const token = PropertiesService.getScriptProperties().getProperty('META_ACCESS_TOKEN');
  if (!token) throw new Error('Falta META_ACCESS_TOKEN');

  const accountIds = getActiveAccounts();
  if (!accountIds.length) return;
  Logger.log(`📊 mensual-cuentas: ${accountIds.length} cuentas...`);

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_MENSUAL) || ss.insertSheet(SHEET_MENSUAL);

  const HEADERS = ['Account ID','Month','Amount Spent',
    'Website Purchases Conversion Value','Impressions',
    'Inline Link Clicks','Website Purchases',
    '3 Seconds Video View','Landing Page Views'];
  if (sheet.getRange(1,1).getValue() !== 'Account ID')
    sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);

  const today           = new Date();
  const currentMonthStr = Utilities.formatDate(new Date(today.getFullYear(), today.getMonth(), 1), 'UTC', 'yyyy-MM-dd');
  const untilStr        = Utilities.formatDate(today, 'UTC', 'yyyy-MM-dd');

  // Primera corrida: desde ene 2026. Siguientes: solo mes actual
  const hasData  = sheet.getLastRow() > 1;
  const sinceStr = hasData ? currentMonthStr : '2026-01-01';

  // Separar filas de meses pasados (no cambian) de las del mes actual
  const currentMonthPrefix = untilStr.slice(0, 7); // YYYY-MM
  const allData = sheet.getDataRange().getValues();
  const pastRows = allData.filter((row, i) => {
    if (i === 0) return false;
    return row[0] && !String(row[1]).startsWith(currentMonthPrefix);
  });

  const existing = new Set(pastRows.filter(r => r[0]).map(r => `${r[0]}_${String(r[1]).slice(0,7)}`));
  const newRows  = [];

  for (const id of accountIds) {
    try {
      const rows = fetchInsights(id, sinceStr, untilStr, token, 'monthly', false);
      for (const row of rows) {
        const key = `${row[0]}_${String(row[1]).slice(0,7)}`;
        if (!existing.has(key)) { newRows.push(row); existing.add(key); }
      }
      Utilities.sleep(1000);
    } catch(e) {
      Logger.log(`⚠️ mensual/${id}: ${e.message}`);
      Utilities.sleep(2000);
    }
  }

  // Reescribir sheet: historial + filas nuevas
  sheet.clearContents();
  const toWrite = [HEADERS, ...pastRows, ...newRows];
  sheet.getRange(1, 1, toWrite.length, HEADERS.length).setValues(toWrite);
  Logger.log(`✅ mensual-cuentas: ${newRows.length} filas nuevas`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ANUNCIOS-MES — mensual por anuncio (últimos ANUNCIOS_DAYS días)
// ═══════════════════════════════════════════════════════════════════════════════
function fetchAnunciosMes() {
  const token = PropertiesService.getScriptProperties().getProperty('META_ACCESS_TOKEN');
  if (!token) throw new Error('Falta META_ACCESS_TOKEN');

  const accountIds = getActiveAccounts();
  if (!accountIds.length) return;
  Logger.log(`📋 anuncios-mes: ${accountIds.length} cuentas...`);

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_ANUNCIOS) || ss.insertSheet(SHEET_ANUNCIOS);

  const HEADERS = ['Account ID','Ad ID','Ad Name','Month','Amount Spent',
    'Website Purchases Conversion Value','Impressions',
    'Inline Link Clicks','Website Purchases',
    '3 Seconds Video View','Landing Page Views'];

  const today = new Date();
  const since = new Date(today); since.setDate(since.getDate() - ANUNCIOS_DAYS);
  const sinceStr = Utilities.formatDate(since, 'UTC', 'yyyy-MM-dd');
  const untilStr = Utilities.formatDate(today, 'UTC', 'yyyy-MM-dd');

  const allRows = [];
  for (const id of accountIds) {
    try {
      const rows = fetchInsights(id, sinceStr, untilStr, token, 'monthly', true);
      allRows.push(...rows);
      Utilities.sleep(1000);
    } catch(e) {
      Logger.log(`⚠️ anuncios/${id}: ${e.message}`);
      Utilities.sleep(2000);
    }
  }

  // Siempre limpiamos y recargamos (60 días, manejable)
  sheet.clearContents();
  if (allRows.length) {
    sheet.getRange(1, 1, allRows.length + 1, HEADERS.length)
      .setValues([HEADERS, ...allRows]);
    Logger.log(`✅ anuncios-mes: ${allRows.length} filas`);
  } else {
    sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
    Logger.log('ℹ️ anuncios-mes: sin datos');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS COMPARTIDOS
// ═══════════════════════════════════════════════════════════════════════════════

function fetchInsights(accountId, since, until, token, timeIncrement, adLevel) {
  const url = `https://graph.facebook.com/${META_VERSION}/act_${accountId}/insights`;
  const payload = {
    fields: adLevel
      ? 'account_id,ad_id,ad_name,spend,impressions,actions,action_values'
      : 'account_id,spend,impressions,actions,action_values',
    time_range: JSON.stringify({ since: since, until: until }),
    time_increment: timeIncrement,
    limit: adLevel ? '200' : '50',
    access_token: token
  };
  if (adLevel) payload.level = 'ad';

  const res  = UrlFetchApp.fetch(url, { method: 'post', payload: payload, muteHttpExceptions: true });
  const json = JSON.parse(res.getContentText());

  if (json.error) { Logger.log(`❌ ${accountId}: ${json.error.message}`); return []; }
  if (json.report_run_id) return fetchAsyncResults(json.report_run_id, accountId, adLevel, token);

  return parseRows(accountId, json.data || [], adLevel);
}

function fetchAsyncResults(reportRunId, accountId, adLevel, token) {
  const MAX = 15, POLL = 4000;
  for (let i = 0; i < MAX; i++) {
    Utilities.sleep(POLL);
    const s = JSON.parse(UrlFetchApp.fetch(
      `https://graph.facebook.com/${META_VERSION}/${reportRunId}?access_token=${token}`,
      { muteHttpExceptions: true }
    ).getContentText());
    Logger.log(`  ↳ ${s.async_status} ${s.async_percent_completion || 0}%`);
    if (s.async_status === 'Job Completed') {
      const d = JSON.parse(UrlFetchApp.fetch(
        `https://graph.facebook.com/${META_VERSION}/${reportRunId}/insights?limit=500&access_token=${token}`,
        { muteHttpExceptions: true }
      ).getContentText());
      return parseRows(accountId, d.data || [], adLevel);
    }
    if (s.async_status === 'Job Failed') { Logger.log(`❌ Job falló: ${accountId}`); return []; }
  }
  Logger.log(`⏰ Timeout: ${accountId}`);
  return [];
}

function parseRows(accountId, data, adLevel) {
  return data.map(d => adLevel
    ? [ accountId, d.ad_id || '', d.ad_name || '', d.date_start,
        parseFloat(d.spend || 0),
        getVal(d.action_values, 'omni_purchase') || getVal(d.action_values, 'purchase'),
        parseInt(d.impressions || 0),
        getVal(d.actions, 'link_click'),
        getVal(d.actions, 'omni_purchase') || getVal(d.actions, 'purchase'),
        getVal(d.actions, 'video_view'),
        getVal(d.actions, 'landing_page_view') ]
    : [ accountId, d.date_start,
        parseFloat(d.spend || 0),
        getVal(d.action_values, 'omni_purchase') || getVal(d.action_values, 'purchase'),
        parseInt(d.impressions || 0),
        getVal(d.actions, 'link_click'),
        getVal(d.actions, 'omni_purchase') || getVal(d.actions, 'purchase'),
        getVal(d.actions, 'video_view'),
        getVal(d.actions, 'landing_page_view') ]
  );
}

function getVal(arr, type) {
  if (!arr) return 0;
  const f = arr.find(a => a.action_type === type);
  return f ? parseFloat(f.value) : 0;
}
