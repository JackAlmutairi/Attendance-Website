/*
    SETUP
*/
require('dotenv').config();

const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const session = require('express-session');
const db = require('./db-connector');
const ExcelJS = require('exceljs');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));


app.use(session({
  secret: process.env.SESSION_SECRET || 'fallbacksecret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false
  }
}));
app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

function requireAdmin(req, res, next) {
  if (req.session && (req.session.role === 'admin' || req.session.role === 'superadmin')) {
    return next();
  }

  res.redirect('/login');
}

function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.role === 'superadmin') {
    return next();
  }

  res.redirect('/login');
}
function isAttendanceOpen() {
  const kuwaitNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kuwait" })
  );

  const hour = kuwaitNow.getHours();
  const minute = kuwaitNow.getMinutes();
  const totalMinutes = hour * 60 + minute;

  const start = 8 * 60;   // 8:00 AM
  const end = 11 * 60;    // 11:00 AM

  return totalMinutes >= start && totalMinutes <= end;
}

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  if (
    username === process.env.SUPERADMIN_USERNAME &&
    password === process.env.SUPERADMIN_PASSWORD
  ) {
    req.session.loggedIn = true;
    req.session.role = 'superadmin';
    req.session.username = username;

    return res.redirect('/superadmin/dashboard');
  }

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.loggedIn = true;
    req.session.role = 'admin';
    req.session.username = username;

    return res.redirect('/');
  }

  res.render('login', { error: 'Invalid username or password' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});


app.get('/', requireAdmin, async function (req, res) {
  try {
    if (req.session.role !== 'superadmin' && !isAttendanceOpen()) {
    return res.render('attendance-closed');
  }
const kuwaitDate = new Date().toLocaleDateString('en-CA', {
  timeZone: 'Asia/Kuwait'
});

const query = `
SELECT 
  c.classID,
  c.className,

  CASE
    WHEN DATE(a.latestSubmission) = ? THEN t.teacherName
    ELSE NULL
  END AS teacherName

FROM Classes c

LEFT JOIN Teachers t
  ON c.currentTeacherID = t.teacherID

LEFT JOIN (
  SELECT 
    classID,
    MAX(attendenceDate) AS latestSubmission
  FROM Attendence
  GROUP BY classID
) a
  ON a.classID = c.classID

ORDER BY c.className
`;

    const [classes] = await db.query(query, [kuwaitDate]);

    res.render('classes', {
        classes: classes
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Database Error");
  }
});

app.get('/superadmin/dashboard', requireSuperAdmin, async (req, res) => {
  try {
    const kuwaitDate = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kuwait'
    });

    const classQuery = `
  SELECT
    c.classID,
    c.className,

    COUNT(DISTINCT s.studentID) AS totalStudents,

    CASE
      WHEN DATE(latest.latestSubmission) = ?
      THEN COUNT(CASE WHEN a.status = 'Absent' THEN 1 END)
      ELSE NULL
    END AS totalAbsences,

    CASE
      WHEN DATE(latest.latestSubmission) = ?
      THEN COUNT(CASE WHEN a.status = 'Present' THEN 1 END)
      ELSE NULL
    END AS totalAttendees,

    latest.latestSubmission AS lastAttendanceDate,

    CASE
      WHEN DATE(latest.latestSubmission) = ? THEN 1
      ELSE 0
    END AS submittedToday

  FROM Classes c
  LEFT JOIN Students s
    ON s.classID = c.classID
  LEFT JOIN (
    SELECT
      classID,
      MAX(attendenceDate) AS latestSubmission
    FROM Attendence
    GROUP BY classID
  ) latest
    ON latest.classID = c.classID
  LEFT JOIN Attendence a
    ON a.classID = c.classID
    AND a.studentID = s.studentID
    AND a.attendenceDate = latest.latestSubmission

  GROUP BY c.classID, c.className, latest.latestSubmission
  ORDER BY c.className ASC
`;

    const [cards] = await db.query(classQuery, [kuwaitDate, kuwaitDate, kuwaitDate]);

    res.render('superadmin-dashboard', {
      cards
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Database Error");
  }
});

app.get('/superadmin/attendance-records', requireSuperAdmin, async (req, res) => {
  try {
    const selectedDate = req.query.selectedDate || '';
    const kuwaitDate = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kuwait'
    });
    const effectiveDate = selectedDate || kuwaitDate;

    const recordsQuery = `
      SELECT
        DATE(a.attendenceDate) AS attendanceDate,
        c.className,
        COUNT(*) AS totalStudents,
        SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS totalAbsent,
        SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS totalPresent
      FROM Attendence a
      JOIN Classes c ON a.classID = c.classID
      JOIN (
        SELECT
          classID,
          DATE(attendenceDate) AS attendanceDay,
          MAX(attendenceDate) AS latestSubmission
        FROM Attendence
        WHERE DATE(attendenceDate) = ?
        GROUP BY classID, DATE(attendenceDate)
      ) latest
        ON a.classID = latest.classID
        AND DATE(a.attendenceDate) = latest.attendanceDay
        AND a.attendenceDate = latest.latestSubmission
      GROUP BY DATE(a.attendenceDate), c.className
      ORDER BY c.className ASC
    `;

    const [rows] = await db.query(recordsQuery, [effectiveDate]);
    const records = rows;

    let gradeQuery = '';
    let gradeParams = [];

    if (selectedDate) {
      gradeQuery = `
        SELECT
          gradeLevel,
          totalStudents,
          totalPresent,
          totalAbsent,
          lastAttendanceDate,
          totalSectors,
          submittedSectors,
          CASE
            WHEN totalSectors = submittedSectors AND totalSectors > 0 THEN 1
            ELSE 0
          END AS allSubmitted
        FROM (
          SELECT
            SUBSTRING_INDEX(c.className, '-', 1) AS gradeLevel,
            COUNT(DISTINCT s.studentID) AS totalStudents,
            COUNT(CASE WHEN a.status = 'Present' THEN 1 END) AS totalPresent,
            COUNT(CASE WHEN a.status = 'Absent' THEN 1 END) AS totalAbsent,
            MAX(latest.latestSubmission) AS lastAttendanceDate,
            COUNT(DISTINCT c.classID) AS totalSectors,
            COUNT(DISTINCT CASE
              WHEN latest.latestSubmission IS NOT NULL THEN c.classID
              ELSE NULL
            END) AS submittedSectors
          FROM Classes c
          LEFT JOIN Students s
            ON s.classID = c.classID
          LEFT JOIN (
            SELECT
              classID,
              MAX(attendenceDate) AS latestSubmission
            FROM Attendence
            WHERE DATE(attendenceDate) = ?
            GROUP BY classID
          ) latest
            ON latest.classID = c.classID
          LEFT JOIN Attendence a
            ON a.classID = c.classID
            AND a.studentID = s.studentID
            AND a.attendenceDate = latest.latestSubmission
          GROUP BY SUBSTRING_INDEX(c.className, '-', 1)
        ) AS groupedGrades
        ORDER BY CAST(gradeLevel AS UNSIGNED)
      `;
      gradeParams = [selectedDate];
    } else {
      gradeQuery = `
  SELECT
    gradeLevel,
    totalStudents,
    totalPresent,
    totalAbsent,
    lastAttendanceDate,
    totalSectors,
    submittedSectors,
    CASE
      WHEN totalSectors = submittedSectors AND totalSectors > 0 THEN 1
      ELSE 0
    END AS allSubmitted
  FROM (
    SELECT
      SUBSTRING_INDEX(c.className, '-', 1) AS gradeLevel,
      COUNT(DISTINCT s.studentID) AS totalStudents,
      SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS totalPresent,
      SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS totalAbsent,
      MAX(latest.latestSubmission) AS lastAttendanceDate,
      COUNT(DISTINCT c.classID) AS totalSectors,
      COUNT(DISTINCT CASE
        WHEN latest.latestSubmission IS NOT NULL THEN c.classID
        ELSE NULL
      END) AS submittedSectors
    FROM Classes c
    LEFT JOIN Students s
      ON s.classID = c.classID
    LEFT JOIN (
      SELECT
        classID,
        MAX(attendenceDate) AS latestSubmission
      FROM Attendence
      WHERE DATE(attendenceDate) = ?
      GROUP BY classID
    ) latest
      ON latest.classID = c.classID
    LEFT JOIN Attendence a
      ON a.classID = c.classID
      AND a.studentID = s.studentID
      AND a.attendenceDate = latest.latestSubmission
    GROUP BY SUBSTRING_INDEX(c.className, '-', 1)
  ) AS groupedGrades
  ORDER BY CAST(gradeLevel AS UNSIGNED)
`;
gradeParams = [effectiveDate];
}


    let overallQuery = '';
    let overallParams = [];

    if (selectedDate) {
      overallQuery = `
        SELECT
          COUNT(DISTINCT s.studentID) AS totalStudents,
          COUNT(CASE WHEN a.status = 'Present' THEN 1 END) AS totalPresent,
          COUNT(CASE WHEN a.status = 'Absent' THEN 1 END) AS totalAbsent
        FROM Classes c
        LEFT JOIN Students s
          ON s.classID = c.classID
        LEFT JOIN (
          SELECT
            classID,
            MAX(attendenceDate) AS latestSubmission
          FROM Attendence
          WHERE DATE(attendenceDate) = ?
          GROUP BY classID
        ) latest
          ON latest.classID = c.classID
        LEFT JOIN Attendence a
          ON a.classID = c.classID
          AND a.studentID = s.studentID
          AND a.attendenceDate = latest.latestSubmission
      `;
      overallParams = [selectedDate];
    } else {
      overallQuery = `
        SELECT
          COUNT(DISTINCT s.studentID) AS totalStudents,
          COUNT(CASE WHEN a.status = 'Present' THEN 1 END) AS totalPresent,
          COUNT(CASE WHEN a.status = 'Absent' THEN 1 END) AS totalAbsent
        FROM Classes c
        LEFT JOIN Students s
          ON s.classID = c.classID
        LEFT JOIN (
          SELECT
            classID,
            MAX(attendenceDate) AS latestSubmission
          FROM Attendence
          WHERE DATE(attendenceDate) = ?
          GROUP BY classID
        ) latest
          ON latest.classID = c.classID
        LEFT JOIN Attendence a
          ON a.classID = c.classID
          AND a.studentID = s.studentID
          AND a.attendenceDate = latest.latestSubmission
      `;
      overallParams = [effectiveDate];
    }

    const [overallRows] = await db.query(overallQuery, overallParams);
    const [gradeCards] = await db.query(gradeQuery, gradeParams);

    const overall = overallRows[0] || {
      totalStudents: 0,
      totalPresent: 0,
      totalAbsent: 0
    };

    const overallPresentPercentage =
      overall.totalStudents > 0
        ? ((overall.totalPresent * 100) / overall.totalStudents).toFixed(1)
        : 0;

    res.render('superadmin-attendance-records', {
      records,
      gradeCards,
      selectedDate,
      overall,
      overallPresentPercentage,
      kuwaitDate
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Database Error");
  }
});

app.get('/attendance', requireAdmin, async function (req, res) {
  if (req.session.role !== 'superadmin' && !isAttendanceOpen()) {
    return res.render('attendance-closed');
  }

  const classID = req.query.classID;

  try {
    const kuwaitDate = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kuwait'
    });

    const classQuery = `
      SELECT 
        classID, 
        className, 
        currentTeacherID, 
        teacherName 
      FROM Classes 
      LEFT JOIN Teachers 
        ON Classes.currentTeacherID = Teachers.teacherID 
      WHERE classID = ?
    `;

    const studentQuery = `
      SELECT studentID, studentName, status
      FROM Students
      WHERE classID = ?
      ORDER BY studentName ASC
    `;

    const getDate = `
      SELECT attendenceDate
      FROM Attendence
      WHERE classID = ?
      ORDER BY attendenceDate DESC
      LIMIT 1
    `;

    const [classRows] = await db.query(classQuery, [classID]);

    if (!classRows.length) {
      return res.status(404).send("Class not found");
    }

    const [students] = await db.query(studentQuery, [classID]);
    const [lastUpdate] = await db.query(getDate, [classID]);

    const classRow = classRows[0];

    let teacherName = classRow.teacherName || '';
    let currentTeacherID = classRow.currentTeacherID || '';
    let date = lastUpdate.length ? lastUpdate[0].attendenceDate : null;

    if (date) {
      const lastAttendanceDate = new Date(date).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Kuwait'
      });

      if (lastAttendanceDate !== kuwaitDate) {
        teacherName = '';
        currentTeacherID = '';
        date = null;
      }
    } else {
      teacherName = '';
      currentTeacherID = '';
    }

    res.render('attendance', {
      teacherName,
      students,
      classID,
      classRow: {
        ...classRow,
        currentTeacherID
      },
      className: classRow.className,
      date
    });

  } catch (error) {
    console.error(error);
    res.status(500).send("Database Error");
  }
});


app.post('/attendance', requireAdmin, async (req, res) => {
  try {
    if (req.session.role !== 'superadmin' && !isAttendanceOpen()) {
      return res.render('attendance-closed');
    }

    const classID = req.body.classID;
    const teacherName = req.body.currentTeacher ? req.body.currentTeacher.trim() : "";
    const submissionTime = new Date(
  new Date().toLocaleString("en-US", { timeZone: "Asia/Kuwait" })
);

    let teacherID = req.body.currentTeacherID || null;

    if (teacherName !== "") {
      const [teacherRows] = await db.query(
        "SELECT teacherID FROM Teachers WHERE teacherName = ?",
        [teacherName]
      );

      if (teacherRows.length > 0) {
        teacherID = teacherRows[0].teacherID;
      } else {
        const [insertTeacher] = await db.query(
          "INSERT INTO Teachers (teacherName) VALUES (?)",
          [teacherName]
        );
        teacherID = insertTeacher.insertId;
      }

      await db.query(
        "UPDATE Classes SET currentTeacherID = ? WHERE classID = ?",
        [teacherID, classID]
      );
    }

    for (const key in req.body) {
      if (
        key === "classID" ||
        key === "currentTeacher" ||
        key === "currentTeacherID"
      ) {
        continue;
      }

      const studentID = key;
      let status = req.body[key];

      if (Array.isArray(status)) {
        status = status[status.length - 1];
      }

      await db.query(
        "UPDATE Students SET status = ? WHERE studentID = ?",
        [status, studentID]
      );

      await db.query(
        "INSERT INTO Attendence (attendenceDate, classID, studentID, currentTeacherID, status) VALUES (?, ?, ?, ?, ?)",
        [submissionTime, classID, studentID, teacherID, status]
      );
    }

    res.redirect("/attendance?classID=" + classID);

  } catch (error) {
    console.error(error);
    res.status(500).send("Database Error");
  }
});

app.get('/superadmin/export-attendance', requireSuperAdmin, async (req, res) => {
  try {

    const kuwaitDate = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kuwait'
  });

const selectedDate = req.query.selectedDate || kuwaitDate;

    const detailsQuery = `
      SELECT
        c.className,
        SUBSTRING_INDEX(c.className, '-', 1) AS gradeLevel,
        s.studentName,
        a.status,
        DATE(a.attendenceDate) AS attendanceDate
      FROM Attendence a
      JOIN Classes c ON a.classID = c.classID
      JOIN Students s ON a.studentID = s.studentID
      JOIN (
        SELECT
          classID,
          MAX(attendenceDate) AS latestSubmission
        FROM Attendence
        WHERE DATE(attendenceDate) = ?
        GROUP BY classID
      ) latest
        ON a.classID = latest.classID
        AND a.attendenceDate = latest.latestSubmission
      ORDER BY CAST(SUBSTRING_INDEX(c.className, '-', 1) AS UNSIGNED), c.className, s.studentName
    `;

    const totalsByGradeQuery = `
  SELECT *
  FROM (
    SELECT
      SUBSTRING_INDEX(c.className, '-', 1) AS gradeLevel,
      COUNT(CASE WHEN a.status = 'Present' THEN 1 END) AS totalPresent,
      COUNT(CASE WHEN a.status = 'Absent' THEN 1 END) AS totalAbsent
    FROM Attendence a
    JOIN Classes c ON a.classID = c.classID
    JOIN (
      SELECT
        classID,
        MAX(attendenceDate) AS latestSubmission
      FROM Attendence
      WHERE DATE(attendenceDate) = ?
      GROUP BY classID
    ) latest
      ON a.classID = latest.classID
      AND a.attendenceDate = latest.latestSubmission
    GROUP BY SUBSTRING_INDEX(c.className, '-', 1)
  ) AS groupedTotals
  ORDER BY CAST(groupedTotals.gradeLevel AS UNSIGNED)
`;

    const [details] = await db.query(detailsQuery, [selectedDate]);
    const [totalsByGrade] = await db.query(totalsByGradeQuery, [selectedDate]);
    
    if (details.length === 0) {
    return res.status(400).send('No attendance records for this date.');
    }

    const workbook = new ExcelJS.Workbook();

    // Group totals by grade
    const totalsMap = {};
    totalsByGrade.forEach(row => {
      totalsMap[row.gradeLevel] = {
        totalPresent: row.totalPresent || 0,
        totalAbsent: row.totalAbsent || 0
      };
    });

    // Group detail rows by grade
    const groupedByGrade = {};
    details.forEach(row => {
      if (!groupedByGrade[row.gradeLevel]) {
        groupedByGrade[row.gradeLevel] = [];
      }
      groupedByGrade[row.gradeLevel].push(row);
    });

    Object.keys(groupedByGrade)
      .sort((a, b) => Number(a) - Number(b))
      .forEach(gradeLevel => {
        const worksheet = workbook.addWorksheet(`${gradeLevel} الصف `);
        const rows = groupedByGrade[gradeLevel];
        const totals = totalsMap[gradeLevel] || { totalPresent: 0, totalAbsent: 0 };

        const cell = worksheet.getCell('A1');
        cell.value = new Date(`${selectedDate}T12:00:00`);
        cell.numFmt = '[$-ar-KW]dddd، d mmmm yyyy'; 
        cell.font = { bold: true, size: 14 };
        worksheet.getCell('A2').value = `الصف: ${gradeLevel}`;
        worksheet.getCell('A3').value = `إجمالي الحضور: ${totals.totalPresent}`;
        worksheet.getCell('A4').value = `إجمالي الغياب: ${totals.totalAbsent}`;

        worksheet.getCell('A1').font = { bold: true, size: 14 };
        worksheet.getCell('A2').font = { bold: true };
        worksheet.getCell('A3').font = { bold: true };
        worksheet.getCell('A4').font = { bold: true };

        let currentRow = 6;
        let currentClass = '';

        rows.forEach(row => {
          if (row.className !== currentClass) {
            currentClass = row.className;

            worksheet.getCell(`A${currentRow}`).value = currentClass;
            worksheet.getCell(`A${currentRow}`).font = { bold: true, size: 12 };
            currentRow++;

            worksheet.getCell(`A${currentRow}`).value = 'الطالبات';
            worksheet.getCell(`B${currentRow}`).value = 'الحالة';
            worksheet.getRow(currentRow).font = { bold: true };
            currentRow++;
          }

          worksheet.getCell(`A${currentRow}`).value = row.studentName;
          const arabicStatus = row.status === 'Present' ? 'حاضر' : 'غائب';
          worksheet.getCell(`B${currentRow}`).value = arabicStatus;
          currentRow++;
        });

        worksheet.columns = [
        { width: 30 },
        { width: 18 }
      ];
      });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=Attendance-${selectedDate}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error(error);
    res.status(500).send('Database Error');
  }
});

/*
    LISTENER
*/

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  database: process.env.MYSQLDATABASE
});
});