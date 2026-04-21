const { google } = require('googleapis');

const SHEET_ID = '1G7xKRi_xtTjzF86HUbz1vYwMy1kONA_ExNz1hQOXIWo';

// Nombres de pestañas por GID — evita una llamada extra a la API
const SHEET_NAMES = {
  '55753471':  'Datos crudos',
  '360010815': 'objetivos-dashboard',
  '446878211': 'Clientes',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { gid } = req.query;
  if (!gid) return res.status(400).json({ error: 'Falta el parámetro gid' });

  const sheetName = SHEET_NAMES[String(gid)];
  if (!sheetName) return res.status(404).json({ error: `GID desconocido: ${gid}` });

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Traer los datos directamente (sin lookup de metadata)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: sheetName,
    });

    const rows = response.data.values || [];

    // Convertir a CSV
    const csv = rows.map(row =>
      row.map(cell => {
        const s = String(cell ?? '');
        return (s.includes(',') || s.includes('"') || s.includes('\n'))
          ? '"' + s.replace(/"/g, '""') + '"'
          : s;
      }).join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.status(200).send(csv);

  } catch (err) {
    console.error('Error en /api/sheet:', err);
    res.status(500).json({ error: err.message });
  }
}
