DROP TABLE IF EXISTS temp_teachers;
DROP TABLE IF EXISTS TeacherAttendance;
DROP TABLE IF EXISTS SubjectTeachers;
DROP TABLE IF EXISTS TeacherDepartments;

CREATE TABLE TeacherDepartments (
    departmentID INT AUTO_INCREMENT NOT NULL,
    departmentName VARCHAR(100) NOT NULL UNIQUE,
    PRIMARY KEY (departmentID)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE SubjectTeachers (
    teacherID INT AUTO_INCREMENT NOT NULL,
    teacherName VARCHAR(100) NOT NULL,
    departmentID INT NOT NULL,
    PRIMARY KEY (teacherID),
    FOREIGN KEY (departmentID) REFERENCES TeacherDepartments(departmentID)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE TeacherAttendance (
    attendanceID INT AUTO_INCREMENT NOT NULL,
    teacherID INT NOT NULL,
    attendanceDate DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Present',
    PRIMARY KEY (attendanceID),
    UNIQUE KEY unique_teacher_day (teacherID, attendanceDate),
    FOREIGN KEY (teacherID) REFERENCES SubjectTeachers(teacherID)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE temp_teachers (
    teacherName VARCHAR(255) NOT NULL,
    department VARCHAR(255) NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

LOAD DATA LOCAL INFILE 'C:/Users/hmany/OneDrive/Desktop/database/public/excel/teachers.csv'
INTO TABLE temp_teachers
CHARACTER SET utf8mb4
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS
(teacherName, department);

INSERT INTO TeacherDepartments (departmentName)
SELECT DISTINCT TRIM(REPLACE(department, '\r', ''))
FROM temp_teachers;

INSERT INTO SubjectTeachers (teacherName, departmentID)
SELECT
    TRIM(REPLACE(t.teacherName, '\r', '')),
    d.departmentID
FROM temp_teachers t
JOIN TeacherDepartments d
    ON TRIM(REPLACE(t.department, '\r', '')) = d.departmentName;