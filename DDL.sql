SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS Attendence;
DROP TABLE IF EXISTS Students;
DROP TABLE IF EXISTS Classes;
DROP TABLE IF EXISTS Teachers;
DROP TABLE IF EXISTS temp_students;

SET FOREIGN_KEY_CHECKS = 1;


CREATE TABLE Teachers (
    teacherID int AUTO_INCREMENT NOT NULL,
    teacherName varchar(100) NOT NULL UNIQUE,


    PRIMARY KEY (teacherID)
);

CREATE TABLE Classes (
    classID int AUTO_INCREMENT NOT NULL,
    className varchar(100) NOT NULL,
    currentTeacherID int DEFAULT NULL,

    PRIMARY KEY (classID),
    FOREIGN KEY (currentTeacherID) REFERENCES Teachers(teacherID)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE TABLE Students (
    studentID int AUTO_INCREMENT NOT NULL,
    studentName varchar(100) NOT NULL,
    classID int NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'Present',

    PRIMARY KEY (studentID),
    FOREIGN KEY (classID) REFERENCES Classes(classID)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);


CREATE TABLE Attendence (
    attendenceID int AUTO_INCREMENT NOT NULL,
    attendenceDate DATETIME NOT NULL,
    classID int NOT NULL,
    studentID int NOT NULL,
    currentTeacherID int DEFAULT NULL,
    status varchar(20) NOT NULL DEFAULT 'Present',

    PRIMARY KEY (attendenceID),

    FOREIGN KEY (classID) REFERENCES Classes(classID)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
    FOREIGN KEY (studentID) REFERENCES Students(studentID)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

    FOREIGN KEY (currentTeacherID) REFERENCES Teachers(teacherID)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

INSERT INTO Classes (className, currentTeacherID) VALUES
('6-1', NULL),
('6-2', NULL),
('6-3', NULL),
('6-4', NULL),
('6-5', NULL),
('7-1', NULL),
('7-2', NULL),
('7-3', NULL),
('7-4', NULL),
('7-5', NULL),
('8-1', NULL),
('8-2', NULL),
('8-3', NULL),
('8-4', NULL),
('8-5', NULL),
('9-1', NULL),
('9-2', NULL),
('9-3', NULL),
('9-4', NULL);

CREATE TABLE temp_students (
    studentName VARCHAR(255) NOT NULL,
    sector INT
) CHARACTER SET utf8mb4;


-- ==============================================
--                  GRADE 6
-- ==============================================
LOAD DATA LOCAL INFILE 'C:/Users/hmany/OneDrive/Desktop/database/public/Excel/Students6.csv'
INTO TABLE temp_students
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS
(studentName, sector);

INSERT INTO Students (studentName, classID, status)
SELECT
    t.studentName,
    c.classID,
    'Present'
FROM temp_students t
JOIN Classes c
ON c.className = CONCAT('6-', t.sector);

TRUNCATE TABLE temp_students;

-- ==============================================
--                  GRADE 7
-- ==============================================

LOAD DATA LOCAL INFILE 'C:/Users/hmany/OneDrive/Desktop/database/public/Excel/Students7.csv'
INTO TABLE temp_students
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS
(studentName, sector);

INSERT INTO Students (studentName, classID, status)
SELECT
    t.studentName,
    c.classID,
    'Present'
FROM temp_students t
JOIN Classes c
ON c.className = CONCAT('7-', t.sector);

TRUNCATE TABLE temp_students;


-- ==============================================
--                  GRADE 8
-- ==============================================

LOAD DATA LOCAL INFILE 'C:/Users/hmany/OneDrive/Desktop/database/public/Excel/Students8.csv'
INTO TABLE temp_students
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS
(studentName, sector);

INSERT INTO Students (studentName, classID, status)
SELECT
    t.studentName,
    c.classID,
    'Present'
FROM temp_students t
JOIN Classes c
ON c.className = CONCAT('8-', t.sector);

TRUNCATE TABLE temp_students;

-- ==============================================
--                  GRADE 9
-- ==============================================


LOAD DATA LOCAL INFILE 'C:/Users/hmany/OneDrive/Desktop/database/public/Excel/Students9.csv'
INTO TABLE temp_students
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS
(studentName, sector);


INSERT INTO Students (studentName, classID, status)
SELECT
    t.studentName,
    c.classID,
    'Present'
FROM temp_students t
JOIN Classes c
ON c.className = CONCAT('9-', t.sector);

TRUNCATE TABLE temp_students;



