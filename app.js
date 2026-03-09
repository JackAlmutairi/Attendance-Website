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
  const kuwaitTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Kuwait" });
  const hour = new Date(kuwaitTime).getHours();

  if (hour >= 13 && req.session?.role !== "superadmin") {
    return res.status(403).render("closed");
  }

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
const query = `
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
      AND DATE(a.attendenceDate) = (
        SELECT DATE(MAX(a2.attendenceDate))
        FROM Attendence a2
        WHERE a2.classID = c.classID
      )
      AND a.status = 'Absent'
    ) AS totalAbsences,

    (
      SELECT COUNT(*)
      FROM Attendence a
      WHERE a.classID = c.classID
      AND DATE(a.attendenceDate) = (
        SELECT DATE(MAX(a2.attendenceDate))
        FROM Attendence a2
        WHERE a2.classID = c.classID
      )
      AND a.status = 'Present'
    ) AS totalAttendees,

    (
      SELECT MAX(a.attendenceDate)
      FROM Attendence a
      WHERE a.classID = c.classID
    ) AS lastAttendanceDate

  FROM Classes c
  ORDER BY c.className ASC
`;

    const [cards] = await db.query(query);

    res.render('superadmin-dashboard', {
      cards: cards
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Database Error');
  }
});

app.get('/attendance', requireAdmin, async function (req, res) {
    const classID= req.query.classID;

    try {
        const classQuery = ('SELECT classID, className, currentTeacherID, teacherName FROM Classes LEFT JOIN Teachers ON Classes.currentTeacherID = Teachers.teacherID WHERE classID=?');
        const studentQuery = ('SELECT studentID, studentName, status FROM Students WHERE classID=? ORDER BY studentName ASC;');
        const tName = ('SELECT teacherName FROM Classes LEFT JOIN Teachers ON Classes.currentTeacherID = Teachers.teacherID WHERE classID=?');
        const getDate = 'SELECT attendenceDate FROM Attendence WHERE classID=? ORDER BY attendenceDate DESC LIMIT 1';

        const [classRows] = await db.query(classQuery, [classID]);
        const [students] = await db.query(studentQuery, [classID]);
        const classRow = classRows[0];
        const [lastUpdate] = await db.query(getDate, [classID]);

    res.render('attendance', {
        teacherName: classRow.teacherName,
        students: students,
        classID: classID,
        classRow: classRows[0],
        className: classRows[0].className,
        date: lastUpdate.length ? lastUpdate[0].attendenceDate : null
    });
    } catch(error) {
        console.error(error);
        res.status(500).send("Database Error")
    }
});


app.post('/attendance', requireAdmin, async (req, res) => {
  try {
    const classID = req.body.classID;
    const teacherName = req.body.currentTeacher ? req.body.currentTeacher.trim() : "";

    let teacherID = null;

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
        "INSERT INTO Attendence (attendenceDate, classID, studentID, currentTeacherID, status) VALUES (NOW(), ?, ?, ?, ?)",
        [classID, studentID, teacherID, status]
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