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

function requireLogin(req, res, next) {
  if (req.session && req.session.loggedIn) {
    return next();
  }

  res.redirect('/login');
}
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

    const query ='SELECT classID, className, teacherName FROM Classes LEFT JOIN Teachers ON Classes.currentTeacherID = Teachers.teacherID';

    const [classes] = await db.query(query);

    res.render('classes', {
        classes: classes
    });
});

app.get('/superadmin/dashboard', requireSuperAdmin, async (req, res) => {
  try {
    const classQuery = `
      SELECT
        c.classID,
        c.className,

        (
          SELECT COUNT(*)
          FROM Students s
          WHERE s.classID = c.classID
        ) AS totalStudents,

        (
          SELECT COUNT(*)
          FROM Attendence a
          WHERE a.classID = c.classID
            AND a.attendenceDate = (
              SELECT MAX(a2.attendenceDate)
              FROM Attendence a2
              WHERE a2.classID = c.classID
            )
            AND a.status = 'Absent'
        ) AS totalAbsences,

        (
          SELECT COUNT(*)
          FROM Attendence a
          WHERE a.classID = c.classID
            AND a.attendenceDate = (
              SELECT MAX(a2.attendenceDate)
              FROM Attendence a2
              WHERE a2.classID = c.classID
            )
            AND a.status = 'Present'
        ) AS totalAttendees,

        (
          SELECT MAX(a.attendenceDate)
          FROM Attendence a
          WHERE a.classID = c.classID
        ) AS lastAttendanceDate,

        CASE
          WHEN DATE((
            SELECT MAX(a.attendenceDate)
            FROM Attendence a
            WHERE a.classID = c.classID
          )) = CURDATE()
          THEN 1
          ELSE 0
        END AS submittedToday

      FROM Classes c
      ORDER BY c.className ASC
    `;

    const [cards] = await db.query(classQuery);

    res.render('superadmin-dashboard', {
      cards
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Database Error');
  }
});

app.get('/superadmin/attendance-records', requireSuperAdmin, async (req, res) => {
  try {
    const selectedDate = req.query.selectedDate || '';
    let records = [];

    if (selectedDate) {
      const query = `
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

      const [rows] = await db.query(query, [selectedDate]);
      records = rows;
    }

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
            MAX(a.attendenceDate) AS lastAttendanceDate,
            COUNT(DISTINCT c.classID) AS totalSectors,
            COUNT(DISTINCT CASE
              WHEN DATE(latest.latestSubmission) = CURDATE() THEN c.classID
              ELSE NULL
            END) AS submittedSectors
          FROM Classes c
          LEFT JOIN Students s
            ON s.classID = c.classID
          LEFT JOIN Attendence a
            ON a.studentID = s.studentID
            AND a.attendenceDate = (
              SELECT MAX(a2.attendenceDate)
              FROM Attendence a2
              WHERE a2.classID = c.classID
            )
          LEFT JOIN (
            SELECT classID, MAX(attendenceDate) AS latestSubmission
            FROM Attendence
            GROUP BY classID
          ) latest
            ON latest.classID = c.classID
          GROUP BY SUBSTRING_INDEX(c.className, '-', 1)
        ) AS groupedGrades
        ORDER BY CAST(gradeLevel AS UNSIGNED)
      `;
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
    WHERE DATE(attendenceDate) = CURDATE()
    GROUP BY classID
  ) latest
    ON latest.classID = c.classID
  LEFT JOIN Attendence a
    ON a.classID = c.classID
    AND a.studentID = s.studentID
    AND a.attendenceDate = latest.latestSubmission
`;
}
  const [overallRows] = await db.query(overallQuery, overallParams);

  const overall = overallRows[0] || {
  totalStudents: 0,
  totalPresent: 0,
  totalAbsent: 0
};

  const overallPresentPercentage =
  overall.totalStudents > 0
    ? ((overall.totalPresent * 100) / overall.totalStudents).toFixed(1)
    : 0;

    const [gradeCards] = await db.query(gradeQuery, gradeParams);


    res.render('superadmin-attendance-records', {
      records,
      gradeCards,
      selectedDate,
      overall,
      overallPresentPercentage
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Database Error');
  }
});

app.get('/attendance', requireAdmin, async function (req, res) {
  const classID = req.query.classID;

  try {
    const classQuery = 'SELECT classID, className, currentTeacherID, teacherName FROM Classes LEFT JOIN Teachers ON Classes.currentTeacherID = Teachers.teacherID WHERE classID=?';
    const studentQuery = 'SELECT studentID, studentName, status FROM Students WHERE classID=? ORDER BY studentName ASC;';
    const getDate = 'SELECT attendenceDate FROM Attendence WHERE classID=? ORDER BY attendenceDate DESC LIMIT 1';

    const [classRows] = await db.query(classQuery, [classID]);

    if (!classRows.length) {
      return res.status(404).send("Class not found");
    }

    const [students] = await db.query(studentQuery, [classID]);
    const [lastUpdate] = await db.query(getDate, [classID]);

    const classRow = classRows[0];

    res.render('attendance', {
      teacherName: classRow.teacherName,
      students: students,
      classID: classID,
      classRow: classRow,
      className: classRow.className,
      date: lastUpdate.length ? lastUpdate[0].attendenceDate : null
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Database Error");
  }
});


app.post('/attendance', requireAdmin, async (req, res) => {
  try {
    const classID = req.body.classID;
    const teacherName = req.body.currentTeacher ? req.body.currentTeacher.trim() : "";
    const submissionTime = new Date();

    let teacherID = req.body.currentTeacherID || null;

    // Find or create teacher
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

      // Update class once
      await db.query(
        "UPDATE Classes SET currentTeacherID = ? WHERE classID = ?",
        [teacherID, classID]
      );
    }

    // Update each student's current status and save attendance record
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