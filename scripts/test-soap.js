const sql = require('mssql');

function decodeRtf(rtf) {
  if (!rtf) return '';
  const bytes = [];
  let result = '';
  let i = 0;
  while (i < rtf.length) {
    if (rtf[i] === '\\' && rtf[i+1] === "'" && i+3 < rtf.length) {
      bytes.push(parseInt(rtf.substr(i+2, 2), 16));
      i += 4;
    } else {
      if (bytes.length > 0) {
        try { result += new TextDecoder('euc-kr').decode(Buffer.from(bytes)); } catch {}
        bytes.length = 0;
      }
      if (rtf.substr(i, 4) === '\\par') {
        result += '\n';
        i += 4;
        if (rtf[i] === ' ') i++;
      } else if (rtf[i] === '\\' && i+1 < rtf.length && /[a-z]/i.test(rtf[i+1])) {
        while (i < rtf.length && rtf[i] !== ' ' && rtf[i] !== '\\' && rtf[i] !== '{' && rtf[i] !== '}') i++;
        if (rtf[i] === ' ') i++;
      } else if (rtf[i] === '{' || rtf[i] === '}') {
        i++;
      } else {
        result += rtf[i];
        i++;
      }
    }
  }
  if (bytes.length > 0) {
    try { result += new TextDecoder('euc-kr').decode(Buffer.from(bytes)); } catch {}
  }
  return result.trim();
}

const labels = {0:'S', 1:'O', 2:'A', 3:'P'};

sql.connect({
  server: '192.168.0.253', port: 1433,
  user: 'sa', password: 'brain!@#$',
  database: 'BrOcs',
  options: { encrypt: false, trustServerCertificate: true }
}).then(async pool => {
  const r = await pool.query(`
    SELECT note_cham, note_date, note_gubun, note_time,
      CAST(note_contentsRTF AS VARCHAR(MAX)) AS rtf
    FROM Onote
    WHERE note_cham = '0000000724' AND note_date = '20260415'
    ORDER BY note_gubun
  `);

  console.log('Patient 0000000724, 2026-04-15:');
  r.recordset.forEach(x => {
    const text = decodeRtf(x.rtf);
    console.log(`${labels[x.note_gubun] || x.note_gubun}: ${text}`);
  });
  process.exit();
}).catch(e => { console.log(e.message); process.exit(); });
