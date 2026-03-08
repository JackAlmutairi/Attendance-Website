/*
    SETUP
*/
require('dotenv').config();

const express = require('express');
const path = require('path');
const app = express();
const PORT = 8000

const db = require('./db-connector');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', async function (req, res) {

    const query ='SELECT classID, className, teacherName FROM Classes LEFT JOIN Teachers ON Classes.currentTeacherID = Teachers.teacherID';

    const [classes] = await db.query(query);

    res.render('classes', {
        classes: classes
    });
});

app.get('/attendance', async function (req, res) {
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


app.post('/attendance', async (req, res) => {
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
        "INSERT INTO Attendence (attendenceDate, classID, studentID, currentTeacherID) VALUES (NOW(), ?, ?, ?)",
        [classID, studentID, teacherID]
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
app.listen(PORT, () => {
  console.log('Server running on port %s', PORT);
});