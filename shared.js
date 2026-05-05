// ─── Config ───────────────────────────────────────────────────────────────────
const GID         = '350698360';
const TARGETS_GID = '332486905';
const CLIENTS_GID = '0';
const BATCH_URL   = '/api/sheets';

// ─── Fetch batch (trae las 3 pestañas en una sola llamada) ────────────────────
async function fetchAllSheets() {
  const key = 'fdc_cache_all_sheets';
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) return data;
    }
  } catch (e) {}

  const res = await fetch(BATCH_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  try {
    sessionStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) {}

  return data;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutos en ms

// ─── Fetch con caché (sessionStorage) ────────────────────────────────────────
async function fetchWithCache(url, ttl = CACHE_TTL) {
  const key = `fdc_cache_${url}`;
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < ttl) return data;
    }
  } catch (e) { /* sessionStorage no disponible, continuar sin caché */ }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.text();

  try {
    sessionStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) { /* cuota excedida, ignorar */ }

  return data;
}

// ─── Validación de columnas ───────────────────────────────────────────────────
const REQUIRED_COLUMNS = [
  'Account ID',
  'Date',
  'Amount Spent',
  'Website Purchases Conversion Value',
  'Impressions',
  'Inline Link Clicks',
  'Website Purchases',
  '3 Seconds Video View',
  'Landing Page Views',
];

function validateColumns(headers) {
  const missing = REQUIRED_COLUMNS.filter(col => !headers.includes(col));
  if (missing.length > 0) {
    console.warn(`⚠️ Columnas faltantes en el CSV: ${missing.join(', ')}`);
  }
  return missing;
}

// ─── Helpers numéricos ────────────────────────────────────────────────────────
function parseNumber(str) {
  if (!str) return 0;
  const clean = str.replace(/"/g, '').trim();
  // tiene punto Y coma → punto es separador de miles, coma es decimal
  if (clean.includes('.') && clean.includes(','))
    return parseFloat(clean.replace(/\./g, '').replace(',', '.')) || 0;
  // tiene solo coma → coma es decimal
  if (clean.includes(',') && !clean.includes('.'))
    return parseFloat(clean.replace(',', '.')) || 0;
  // tiene solo punto → si hay exactamente 3 dígitos después del punto, es separador de miles
  // ej: "37.911" → 37911, "1.220.163" → ya no llega acá (tiene dos puntos)
  if (clean.includes('.') && /^\d+\.\d{3}$/.test(clean))
    return parseFloat(clean.replace('.', '')) || 0;
  const result = parseFloat(clean) || 0;
  return isFinite(result) ? result : 0;
}

function parseTargetNumber(str) {
  if (!str) return 0;
  const clean = str.replace(/[$\s]/g, '').trim();
  return parseFloat(clean.replace(/\./g, '').replace(',', '.')) || 0;
}

// ─── Helpers de formato ───────────────────────────────────────────────────────
function fmtRoas(n) {
  return (!n || n === 0) ? '—' : n.toFixed(2) + 'x';
}

function fmtDateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d} ${months[m - 1]}`;
}

function roasColor(roas, target) {
  if (!target) return '';
  if (roas >= target)        return 'roas-green';
  if (roas >= target * 0.75) return 'roas-yellow';
  return 'roas-red';
}

// ─── CSV Parser (Papa Parse) ──────────────────────────────────────────────────
function parseCSV(text) {
  const result = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  return result.data;
}

function parseCSVLine(line) {
  const result = Papa.parse(line);
  return result.data[0] || [];
}

// ─── Fetch seguro (con aviso de error) ───────────────────────────────────────
async function fetchSafe(url) {
  try {
    return { data: await fetchWithCache(url), failed: false };
  } catch (e) {
    console.error(`fetchSafe: error al cargar ${url}`, e);
    return { data: '', failed: true };
  }
}

// ─── Filtro de período ────────────────────────────────────────────────────────
function filterByPeriod(rows, period) {
  if (period === 'all') return rows;
  if (period === 'custom') {
    const from = document.getElementById('date-from').value;
    const to   = document.getElementById('date-to').value;
    if (!from && !to) return rows;
    return rows.filter(r => {
      const d = r['Date'];
      if (!d) return false;
      if (from && d < from) return false;
      if (to   && d > to)   return false;
      return true;
    });
  }
  if (period === 'this_month') {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return rows.filter(r => r['Date'] && r['Date'].startsWith(prefix));
  }
  if (period === 'last_month') {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return rows.filter(r => r['Date'] && r['Date'].startsWith(prefix));
  }
  const dates = rows.map(r => new Date(r['Date'])).filter(d => !isNaN(d));
  if (!dates.length) return rows;
  const maxDate = new Date(Math.max(...dates));
  const cutoff  = new Date(maxDate);
  cutoff.setDate(cutoff.getDate() - (period - 1));
  return rows.filter(r => {
    const d = new Date(r['Date']);
    return !isNaN(d) && d >= cutoff;
  });
}

// ─── Filtro de anuncios por período (usa columna Month en vez de Date) ────────
function filterAdsByPeriod(rows, period) {
  if (period === 'all') return rows;
  const now = new Date();
  if (period === 'this_month') {
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return rows.filter(r => r['Month'] && String(r['Month']).slice(0, 7) === prefix);
  }
  if (period === 'last_month') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return rows.filter(r => r['Month'] && String(r['Month']).slice(0, 7) === prefix);
  }
  if (period === 'custom') {
    const from = document.getElementById('date-from')?.value;
    const to   = document.getElementById('date-to')?.value;
    if (!from && !to) return rows;
    return rows.filter(r => {
      const m = r['Month'] ? String(r['Month']).slice(0, 7) : null;
      if (!m) return false;
      if (from && m < from.slice(0, 7)) return false;
      if (to   && m > to.slice(0, 7))   return false;
      return true;
    });
  }
  // Rolling periods (7, 30, 90): incluir meses que caen dentro del rango
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (period - 1));
  const cutoffPrefix = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
  return rows.filter(r => r['Month'] && String(r['Month']).slice(0, 7) >= cutoffPrefix);
}

// ─── Helpers de objetivos ─────────────────────────────────────────────────────
function getMonthForPeriod(period) {
  const now = new Date();
  if (period === 'this_month') return { year: now.getFullYear(), month: now.getMonth() + 1 };
  if (period === 'last_month') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }
  return null;
}

function getTargetsForMonth(accountId, year, month) {
  const monthNames = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const monthNum  = String(month).padStart(2, '0');
  const monthName = monthNames[month - 1];
  return targetsRows.find(r => {
    if (!r['cuenta publicitaria'] || r['cuenta publicitaria'].trim() !== accountId) return false;
    const m = (r['mes'] || '').trim().toLowerCase();
    return m === monthNum || m === monthName;
  }) || null;
}
