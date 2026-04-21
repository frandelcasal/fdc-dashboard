const { google } = require('googleapis');

const SHEET_ID = '1G7xKRi_xtTjzF86HUbz1vYwMy1kONA_ExNz1hQOXIWo';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { gid } = req.query;
  if (!gid) return res.status(400).json({ error: 'Falta el parámetro gid' });

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Buscar el nombre de la pestaña por su GID
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const sheet = meta.data.sheets.find(s => String(s.properties.sheetId) === String(gid));
    if (!sheet) return res.status(404).json({ error: `No se encontró la pestaña con gid=${gid}` });

    const sheetName = sheet.properties.title;

    // Traer los datos
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
