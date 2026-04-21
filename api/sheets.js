const { google } = require('googleapis');

const SHEET_ID = '1G7xKRi_xtTjzF86HUbz1vYwMy1kONA_ExNz1hQOXIWo';
const RANGES   = ['crudo', 'objetivos-dashboard', 'aux'];

function toCsv(rows) {
  return (rows || []).map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    }).join(',')
  ).join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID,
      ranges: RANGES,
    });

    const [main, targets, clients] = response.data.valueRanges.map(r => toCsv(r.values));

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ main, targets, clients });

  } catch (err) {
    console.error('Error en /api/sheets:', err);
    res.status(500).json({ error: err.message });
  }
}
