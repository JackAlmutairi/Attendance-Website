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
const multer = require('multer');
const XLSX = require('xlsx');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));


if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is missing');
}

app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
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
  const end = 13 * 60;     // 1:00 PM

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

app.get('/teacher-attendance', requireAdmin, async (req, res) => {
  try {
    const [departments] = await db.query(`
      SELECT departmentID, departmentName
      FROM TeacherDepartments
      ORDER BY departmentName
    `);

    res.render('teacher-departments', {
      departments,
      role: req.session.role
    });
  } catch (err) {
    console.error('Error loading teacher departments:', err);
    res.status(500).send('Database Error');
  }
});

app.get('/teacher-attendance/:departmentID', requireAdmin, async (req, res) => {
  try {
    const { departmentID } = req.params;

    const [departmentRows] = await db.query(`
      SELECT departmentID, departmentName
      FROM TeacherDepartments
      WHERE departmentID = ?
    `, [departmentID]);

    if (departmentRows.length === 0) {
      return res.status(404).send('Department not found');
    }

    const kuwaitDate = new Date().toLocaleDateString('en-CA', {
  timeZone: 'Asia/Kuwait'
});

const [teachers] = await db.query(`
  SELECT
    t.teacherID,
    t.teacherName,
    COALESCE(a.status, 'Present') AS status
  FROM SubjectTeachers t
  LEFT JOIN TeacherAttendance a
    ON t.teacherID = a.teacherID
    AND a.attendanceDate = ?
  WHERE t.departmentID = ?
  ORDER BY t.teacherName
`, [kuwaitDate, departmentID]);
const saved = req.query.saved === '1';

    res.render('teacher-attendance', {
      department: departmentRows[0],
      teachers,
      role: req.session.role,
      saved
    });
  } catch (err) {
    console.error('Error loading teacher attendance page:', err);
    res.status(500).send('Database Error');
  }
});

app.post('/teacher-attendance', requireAdmin, async (req, res) => {
  try {
    const { departmentID } = req.body;

    if (!departmentID) {
      return res.status(400).send('Missing department ID');
    }

    const kuwaitDate = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kuwait'
    });

    const [teachers] = await db.query(`
      SELECT teacherID
      FROM SubjectTeachers
      WHERE departmentID = ?
    `, [departmentID]);

    for (const teacher of teachers) {
      const fieldName = `teacher_${teacher.teacherID}`;
      let status = req.body[fieldName];

      if (Array.isArray(status)) {
        status = status[status.length - 1];
      }

      status = status === 'Present' ? 'Present' : 'Absent';

      await db.query(`
        INSERT INTO TeacherAttendance (teacherID, attendanceDate, status)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE status = VALUES(status)
      `, [teacher.teacherID, kuwaitDate, status]);
    }

    await db.query(`
      DELETE FROM TeacherAttendance
      WHERE attendanceDate < ?
    `, [kuwaitDate]);

    res.redirect(`/teacher-attendance/${departmentID}?saved=1`);
  } catch (err) {
    console.error('Error saving teacher attendance:', err);
    res.status(500).send('Database Error');
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


    const teacherOverallQuery = `
  SELECT
    COUNT(st.teacherID) AS totalTeachers,
    SUM(CASE WHEN ta.status = 'Present' THEN 1 ELSE 0 END) AS totalPresent,
    SUM(CASE WHEN ta.status = 'Absent' THEN 1 ELSE 0 END) AS totalAbsent
  FROM SubjectTeachers st
  LEFT JOIN TeacherAttendance ta
    ON ta.teacherID = st.teacherID
    AND ta.attendanceDate = ?
`;

const [teacherOverallRows] = await db.query(teacherOverallQuery, [effectiveDate]);

const teacherOverall = teacherOverallRows[0] || {
  totalTeachers: 0,
  totalPresent: 0,
  totalAbsent: 0
};

const teacherPresentPercentage =
  teacherOverall.totalTeachers > 0
    ? ((teacherOverall.totalPresent * 100) / teacherOverall.totalTeachers).toFixed(1)
    : 0;

    res.render('superadmin-attendance-records', {
      records,
      gradeCards,
      selectedDate,
      overall,
      overallPresentPercentage,
      kuwaitDate,
      teacherOverall,
      teacherPresentPercentage
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
  SELECT 
    s.studentID,
    s.studentName,
    COALESCE(a.status, 'Present') AS status
  FROM Students s
  LEFT JOIN (
    SELECT a1.studentID, a1.status
    FROM Attendence a1
    JOIN (
      SELECT classID, MAX(attendenceDate) AS latestSubmission
      FROM Attendence
      WHERE classID = ? AND DATE(attendenceDate) = ?
      GROUP BY classID
    ) latest
      ON a1.classID = latest.classID
      AND a1.attendenceDate = latest.latestSubmission
  ) a
    ON s.studentID = a.studentID
  WHERE s.classID = ?
  ORDER BY s.studentName ASC
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

    const [students] = await db.query(studentQuery, [classID, kuwaitDate, classID]);
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



app.get('/superadmin/owner', requireSuperAdmin, async (req, res) => {
  try {
    const [classes] = await db.query(`
      SELECT className
      FROM Classes
      ORDER BY className
    `);

    const [departments] = await db.query(`
      SELECT departmentID, departmentName
      FROM TeacherDepartments
      ORDER BY departmentName
    `);

    const [teachers] = await db.query(`
      SELECT
        t.teacherID,
        t.teacherName,
        t.departmentID,
        d.departmentName
      FROM SubjectTeachers t
      JOIN TeacherDepartments d
        ON t.departmentID = d.departmentID
      ORDER BY t.teacherName
    `);

    res.render('superadmin-owner', {
      message: req.query.message || null,
      error: req.query.error || null,
      students: [],
      classes,
      teachers,
      departments
    });
  } catch (error) {
    console.error(error);
    res.render('superadmin-owner', {
      message: null,
      error: 'فشل تحميل الصفحة.',
      students: [],
      classes: [],
      teachers: [],
      departments: []
    });
  }
});

app.post('/superadmin/update-teachers', requireSuperAdmin, async (req, res) => {
  try {
    const teacherIDs = req.body.teacherID;

    if (!teacherIDs) {
      return res.redirect(
        '/superadmin/owner?error=' +
        encodeURIComponent('لا توجد بيانات للحفظ.')
      );
    }

    const ids = Array.isArray(teacherIDs) ? teacherIDs : [teacherIDs];

    for (const id of ids) {
      const teacherName = (req.body[`teacherName_${id}`] || '').trim();
      const departmentID = req.body[`departmentID_${id}`];

      if (!teacherName) {
        continue;
      }

      await db.query(`
        UPDATE SubjectTeachers
        SET teacherName = ?, departmentID = ?
        WHERE teacherID = ?
      `, [teacherName, departmentID, id]);
    }

    res.redirect(
      '/superadmin/owner?message=' +
      encodeURIComponent('تم حفظ بيانات المعلمات بنجاح.')
    );
  } catch (error) {
    console.error(error);
    res.redirect(
      '/superadmin/owner?error=' +
      encodeURIComponent('فشل حفظ بيانات المعلمات.')
    );
  }
});

app.post('/superadmin/delete-teacher', requireSuperAdmin, async (req, res) => {
  try {
    const { teacherID } = req.body;

    await db.query(
      'DELETE FROM SubjectTeachers WHERE teacherID = ?',
      [teacherID]
    );

    res.redirect(
      '/superadmin/owner?message=' +
      encodeURIComponent('تم حذف المعلمة بنجاح.')
    );
  } catch (error) {
    console.error(error);
    res.redirect(
      '/superadmin/owner?error=' +
      encodeURIComponent('فشل حذف المعلمة.')
    );
  }
});

app.post('/superadmin/add-teacher', requireSuperAdmin, async (req, res) => {
  try {
    const { teacherName, departmentID } = req.body;
    const trimmedName = (teacherName || '').trim();

    if (!trimmedName) {
      return res.redirect(
        '/superadmin/owner?error=' +
        encodeURIComponent('اسم المعلمة مطلوب.')
      );
    }

    await db.query(`
      INSERT INTO SubjectTeachers (teacherName, departmentID)
      VALUES (?, ?)
    `, [trimmedName, departmentID]);

    res.redirect(
      '/superadmin/owner?message=' +
      encodeURIComponent('تمت إضافة المعلمة بنجاح.')
    );
  } catch (error) {
    console.error(error);
    res.redirect(
      '/superadmin/owner?error=' +
      encodeURIComponent('فشل إضافة المعلمة.')
    );
  }
});

app.post('/superadmin/reset-attendance', requireSuperAdmin, async (req, res) => {
  const password = (req.body.password || '').trim();

  try {
    const classes = await getOwnerPageClasses();

    if (password !== process.env.OWNER_PASSWORD) {
      return res.status(403).render('superadmin-owner', {
        message: null,
        error: 'كلمة مرور الإدارة غير صحيحة.',
        students: [],
        classes
      });
    }

    await db.query('DELETE FROM Attendence');

    return res.render('superadmin-owner', {
      message: 'تم حذف جميع سجلات الحضور بنجاح.',
      error: null,
      students: [],
      classes
    });
  } catch (error) {
    console.error(error);
    return res.status(500).render('superadmin-owner', {
      message: null,
      error: 'فشل حذف سجلات الحضور.',
      students: [],
      classes: []
    });
  }
});


app.post(
  '/superadmin/import-students',
  requireSuperAdmin,
  upload.single('studentsFile'),
  async (req, res) => {
    let connection;

    try {
      const ownerPassword = (req.body.ownerPassword || '').trim();
      const classes = await getOwnerPageClasses();

      if (ownerPassword !== process.env.OWNER_PASSWORD) {
        return res.status(403).render('superadmin-owner', {
          message: null,
          error: 'كلمة مرور الإدارة غير صحيحة.',
          students: [],
          classes
        });
      }

      if (!req.file) {
        return res.status(400).render('superadmin-owner', {
          message: null,
          error: 'يرجى اختيار ملف Excel.',
          students: [],
          classes
        });
      }

      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const requiredSheets = ['6', '7', '8', '9'];

      connection = await db.getConnection();
      await connection.beginTransaction();

      await connection.query('DELETE FROM Attendence');
      await connection.query('DELETE FROM Students');
      await connection.query('ALTER TABLE Attendence AUTO_INCREMENT = 1');
      await connection.query('ALTER TABLE Students AUTO_INCREMENT = 1');

      let insertedCount = 0;
      const seenRows = new Set();

      for (const grade of requiredSheets) {
        const sheet = workbook.Sheets[grade];

        if (!sheet) {
          throw new Error(`الورقة ${grade} غير موجودة في الملف.`);
        }

        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        for (const row of rows) {
          const studentName = String(row['اسم الطالب'] || '').trim();
          const sectorRaw = String(row['الشعبة'] || '').trim();

          if (!studentName || !sectorRaw) {
            continue;
          }

          const sector = parseInt(sectorRaw, 10);

          if (Number.isNaN(sector)) {
            throw new Error(`رقم الشعبة غير صحيح في صف من صفوف المرحلة ${grade}.`);
          }

          const className = `${grade}-${sector}`;
          const uniqueKey = `${studentName}__${className}`;

          if (seenRows.has(uniqueKey)) {
            continue;
          }

          seenRows.add(uniqueKey);

          const [classRows] = await connection.query(
            'SELECT classID FROM Classes WHERE className = ?',
            [className]
          );

          if (classRows.length === 0) {
            throw new Error(`الفصل ${className} غير موجود في قاعدة البيانات.`);
          }

          const classID = classRows[0].classID;

          await connection.query(
            'INSERT INTO Students (studentName, classID) VALUES (?, ?)',
            [studentName, classID]
          );

          insertedCount++;
        }
      }

      await connection.commit();

      return res.render('superadmin-owner', {
        message: `تم استيراد بيانات الطالبات بنجاح. العدد الكلي: ${insertedCount}`,
        error: null,
        students: [],
        classes
      });

    } catch (error) {
      if (connection) {
        await connection.rollback();
      }

      console.error(error);

      const classes = await getOwnerPageClasses().catch(() => []);

      return res.status(500).render('superadmin-owner', {
        message: null,
        error: error.message || 'فشل استيراد الملف.',
        students: [],
        classes
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
);


app.get('/superadmin/find-student', requireSuperAdmin, async (req, res) => {
  try {
    const studentName = `%${req.query.studentName || ''}%`;

    const [students] = await db.query(`
      SELECT s.studentID, s.studentName AS name, c.className
      FROM Students s
      JOIN Classes c ON s.classID = c.classID
      WHERE s.studentName LIKE ?
      ORDER BY s.studentName
    `, [studentName]);

    const [classes] = await db.query(`
      SELECT className
      FROM Classes
      ORDER BY className
    `);

    res.render('superadmin-owner', {
      students,
      classes,
      message: null,
      error: null
    });
  } catch (error) {
    console.error(error);

    res.render('superadmin-owner', {
      students: [],
      classes: [],
      message: null,
      error: 'فشل البحث.'
    });
  }
});

app.post('/superadmin/update-student', requireSuperAdmin, async (req, res) => {
  try {
    const { studentID, studentName, className } = req.body;

    const trimmedName = (studentName || '').trim();

    if (!trimmedName) {
      return res.redirect(
        '/superadmin/owner?error=' +
        encodeURIComponent('اسم الطالبة مطلوب.')
      );
    }

    const [rows] = await db.query(
      'SELECT classID FROM Classes WHERE className = ?',
      [className]
    );

    if (rows.length === 0) {
      return res.redirect(
        '/superadmin/owner?error=' +
        encodeURIComponent('الفصل غير موجود.')
      );
    }

    const classID = rows[0].classID;

    await db.query(
      `UPDATE Students 
       SET studentName = ?, classID = ?
       WHERE studentID = ?`,
      [trimmedName, classID, studentID]
    );

    res.redirect(
      '/superadmin/owner?message=' +
      encodeURIComponent('تم تعديل بيانات الطالبة بنجاح.')
    );

  } catch (error) {
    console.error(error);

    res.redirect(
      '/superadmin/owner?error=' +
      encodeURIComponent('فشل تعديل بيانات الطالبة.')
    );
  }
});

app.post('/superadmin/delete-student', requireSuperAdmin, async (req, res) => {
  try {
    const { studentID } = req.body;

    await db.query(
      'DELETE FROM Students WHERE studentID = ?',
      [studentID]
    );

    res.redirect('/superadmin/owner?message=' + encodeURIComponent('تم حذف الطالبة بنجاح.'));
  } catch (error) {
    console.error(error);
    res.redirect('/superadmin/owner?error=' + encodeURIComponent('فشل حذف الطالبة.'));
  }
});

app.get('/teacher-attendance', requireAdmin, async (req, res) => {
  try {
    const [departments] = await db.query(`
      SELECT departmentID, departmentName
      FROM TeacherDepartments
      ORDER BY departmentName
    `);

    res.render('teacher-departments', {
      departments,
      role: req.session.role
    });
  } catch (err) {
    console.error('Error loading teacher departments:', err);
    res.status(500).send('Database Error');
  }
});

app.get('/superadmin/find-teacher', requireSuperAdmin, async (req, res) => {
  try {
    const teacherName = `%${req.query.teacherName || ''}%`;

    const [teachers] = await db.query(`
      SELECT 
        t.teacherID,
        t.teacherName,
        d.departmentName
      FROM SubjectTeachers t
      JOIN TeacherDepartments d
        ON t.departmentID = d.departmentID
      WHERE t.teacherName LIKE ?
      ORDER BY t.teacherName
    `, [teacherName]);

    const [departments] = await db.query(`
      SELECT departmentID, departmentName
      FROM TeacherDepartments
      ORDER BY departmentName
    `);

    const [classes] = await db.query(`
      SELECT className
      FROM Classes
      ORDER BY className
    `);

    res.render('superadmin-owner', {
      teachers,
      departments,
      students: [],
      classes,
      message: null,
      error: null
    });

  } catch (error) {
    console.error(error);

    res.render('superadmin-owner', {
      teachers: [],
      departments: [],
      students: [],
      classes: [],
      message: null,
      error: 'فشل البحث عن المعلمة.'
    });
  }
});

app.post('/superadmin/update-teacher', requireSuperAdmin, async (req, res) => {
  try {
    const { teacherID, teacherName, departmentID } = req.body;

    const trimmedName = (teacherName || '').trim();

    if (!trimmedName) {
      return res.redirect(
        '/superadmin/owner?error=' +
        encodeURIComponent('اسم المعلمة مطلوب.')
      );
    }

    await db.query(`
      UPDATE SubjectTeachers
      SET teacherName = ?, departmentID = ?
      WHERE teacherID = ?
    `, [trimmedName, departmentID, teacherID]);

    res.redirect(
      '/superadmin/owner?message=' +
      encodeURIComponent('تم تعديل بيانات المعلمة بنجاح.')
    );

  } catch (error) {
    console.error(error);

    res.redirect(
      '/superadmin/owner?error=' +
      encodeURIComponent('فشل تعديل بيانات المعلمة.')
    );
  }
});

app.post('/superadmin/delete-teacher', requireSuperAdmin, async (req, res) => {
  try {
    const { teacherID } = req.body;

    await db.query(
      'DELETE FROM SubjectTeachers WHERE teacherID = ?',
      [teacherID]
    );

    res.redirect(
      '/superadmin/owner?message=' +
      encodeURIComponent('تم حذف المعلمة بنجاح.')
    );

  } catch (error) {
    console.error(error);

    res.redirect(
      '/superadmin/owner?error=' +
      encodeURIComponent('فشل حذف المعلمة.')
    );
  }
});

app.post('/superadmin/add-teacher', requireSuperAdmin, async (req, res) => {
  try {
    const { teacherName, departmentID } = req.body;

    const trimmedName = (teacherName || '').trim();

    if (!trimmedName) {
      return res.redirect(
        '/superadmin/owner?error=' +
        encodeURIComponent('اسم المعلمة مطلوب.')
      );
    }

    await db.query(`
      INSERT INTO SubjectTeachers (teacherName, departmentID)
      VALUES (?, ?)
    `, [trimmedName, departmentID]);

    res.redirect(
      '/superadmin/owner?message=' +
      encodeURIComponent('تم إضافة المعلمة بنجاح.')
    );

  } catch (error) {
    console.error(error);

    res.redirect(
      '/superadmin/owner?error=' +
      encodeURIComponent('فشل إضافة المعلمة.')
    );
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