CREATE TABLE IF NOT EXISTS TeacherDepartments (
    departmentID INT AUTO_INCREMENT NOT NULL,
    departmentName VARCHAR(100) NOT NULL UNIQUE,
    PRIMARY KEY (departmentID)
);

CREATE TABLE IF NOT EXISTS SubjectTeachers (
    teacherID INT AUTO_INCREMENT NOT NULL,
    teacherName VARCHAR(100) NOT NULL,
    departmentID INT NOT NULL,
    PRIMARY KEY (teacherID),
    FOREIGN KEY (departmentID) REFERENCES TeacherDepartments(departmentID)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS TeacherAttendance (
    attendanceID INT AUTO_INCREMENT NOT NULL,
    teacherID INT NOT NULL,
    attendanceDate DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Present',
    PRIMARY KEY (attendanceID),
    UNIQUE KEY unique_teacher_day (teacherID, attendanceDate),
    FOREIGN KEY (teacherID) REFERENCES SubjectTeachers(teacherID)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);