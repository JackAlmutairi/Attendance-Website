const XLSX = require('xlsx');

function parseStudentWorkbook(workbook) {
  const roster = [];
  const seen = new Set();
  let matchedSheets = 0;
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    const headers = (rows[0] || []).map(v => String(v).trim());
    const nameColumn = headers.indexOf('اسم الطالب');
    const gradeColumn = headers.indexOf('الصف');
    const sectionColumn = headers.indexOf('الشعبة');
    const sheetGrade = /^[6-9]$/.test(sheetName) ? Number(sheetName) : null;
    if (nameColumn < 0 || sectionColumn < 0 || (gradeColumn < 0 && sheetGrade === null)) continue;
    matchedSheets++;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every(v => String(v).trim() === '')) continue;
      const studentName = String(row[nameColumn] ?? '').trim();
      const grade = gradeColumn < 0 ? sheetGrade : Number(row[gradeColumn]);
      const section = Number(row[sectionColumn]);
      if (!studentName || Array.from(studentName).length > 100 || ![6, 7, 8, 9].includes(grade) ||
          !Number.isInteger(section) || section < 1 || section > (grade === 9 ? 4 : 5)) {
        throw new Error(`بيانات غير صحيحة في الورقة ${sheetName}، الصف ${i + 1}.`);
      }
      const className = `${grade}-${section}`;
      const key = JSON.stringify([studentName, className]);
      if (seen.has(key)) throw new Error(`طالبة مكررة في الورقة ${sheetName}، الصف ${i + 1}.`);
      seen.add(key);
      roster.push({ studentName, className });
    }
  }
  if (!matchedSheets || !roster.length) throw new Error('لم يتم العثور على بيانات طالبات. الأعمدة المطلوبة: اسم الطالب، الصف، الشعبة.');
  return roster;
}

module.exports = { parseStudentWorkbook };