const fs = require('fs');
const db = JSON.parse(fs.readFileSync('C:\\Users\\acer\\OneDrive\\Desktop\\pages\\db.json', 'utf8'));

const year = 'all';
const today = new Date().toISOString().split('T')[0];

const yearStudents = year === 'all' ? db.students : db.students.filter(s => s.year === year);
const todaysRecords = year === 'all' ? db.attendanceRecords.filter(r => r.date === today) : db.attendanceRecords.filter(r => r.year === year && r.date === today);

const presentList = todaysRecords.filter(r => r.status === 'Present');
const mappedPresent = presentList.map(r => {
    const student = yearStudents.find(s => s.id === r.studentId) || { name: 'Unknown', year: 'Unknown' };
    return { name: student.name, time: r.time, year: student.year };
});

console.log("TODAY:", today);
console.log("PRESENT LIST:", presentList);
console.log("MAPPED:", mappedPresent);
