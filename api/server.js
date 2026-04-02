const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Face descriptors can be large

// Serve frontend static files from this directory
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'db.json');

// Initial DB state
let db = {
    students: [],
    faceDescriptors: {}, // { "studentId": [[descriptor1], [descriptor2]...] }
    attendanceRecords: [],
    schedules: {},
    dayOrder: 1
};

// Load DB from file
if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        console.error("Error reading db.json, using created defaults.");
    }
} else {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const saveDb = () => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
};

// ==== AUTHENTICATION ====
app.post('/api/auth/login', (req, res) => {
    const { regNo, email } = req.body;
    
    // Admin check
    if (email === "powerhouse.hod@gmail.com" && regNo === "Coolie5821") {
        return res.json({ success: true, user: { role: 'admin' } });
    }

    const student = db.students.find(s => s.id === regNo && s.email === email);
    if (student) {
        return res.json({ success: true, user: { ...student, role: 'student' } });
    } else {
        return res.status(401).json({ success: false, message: 'Student not found' });
    }
});

app.post('/api/auth/register', (req, res) => {
    const { name, regNo, email, year } = req.body;
    
    const exists = db.students.find(s => s.id === regNo);
    if (exists) {
        return res.status(400).json({ success: false, message: 'Student ID already exists' });
    }

    const newStudent = { id: regNo, name, email, year };
    db.students.push(newStudent);
    saveDb();

    res.json({ success: true, user: { ...newStudent, role: 'student' } });
});

// ==== FACE ENROLLMENT & RECOGNITION ====
app.post('/api/face/enroll', (req, res) => {
    const { studentId, descriptors } = req.body;
    if (!studentId || !descriptors) {
        return res.status(400).json({ success: false, message: 'Missing parameters' });
    }

    db.faceDescriptors[studentId] = descriptors;
    saveDb();
    res.json({ success: true });
});

app.get('/api/face/descriptors/:studentId', (req, res) => {
    const { studentId } = req.params;
    const descriptors = db.faceDescriptors[studentId];
    if (descriptors) {
        res.json({ success: true, descriptors });
    } else {
        res.status(404).json({ success: false, message: 'No face descriptors found' });
    }
});

app.get('/api/face/descriptors', (req, res) => {
    // For when we need all descriptors (unused currently, but good to have)
    res.json({ success: true, descriptors: db.faceDescriptors });
});

// ==== SCHEDULE AND SETTINGS ====
app.get('/api/settings/dayOrder', (req, res) => {
    res.json({ success: true, dayOrder: db.dayOrder });
});

app.post('/api/settings/dayOrder', (req, res) => {
    const { dayOrder } = req.body;
    db.dayOrder = dayOrder;
    saveDb();
    res.json({ success: true, dayOrder: db.dayOrder });
});

app.get('/api/schedule/:year/:dayOrder', (req, res) => {
    const { year, dayOrder } = req.params;
    const key = `${year}_${dayOrder}`;
    const schedule = db.schedules[key] || { p1:'', p2:'', p3:'', p4:'', p5:'' };
    res.json({ success: true, schedule });
});

app.post('/api/schedule/:year/:dayOrder', (req, res) => {
    const { year, dayOrder } = req.params;
    const schedule = req.body; // {p1, p2, p3, p4, p5}
    const key = `${year}_${dayOrder}`;
    
    db.schedules[key] = schedule;
    saveDb();
    res.json({ success: true, schedule });
});

// ==== PROFILE UPDATES ====
app.put('/api/student/profile/:studentId', (req, res) => {
    const { studentId } = req.params;
    const { name, regNo, email, year, photo } = req.body;
    
    // Find student
    const studentIdx = db.students.findIndex(s => s.id === studentId);
    if (studentIdx === -1) {
        return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const student = db.students[studentIdx];
    
    // Check if new regNo overlaps with another student (not themselves)
    if (regNo && regNo !== studentId) {
        const exists = db.students.find(s => s.id === regNo);
        if (exists) {
            return res.status(400).json({ success: false, message: 'Register Number already in use.' });
        }
    }

    // Update details incrementally
    if (name) student.name = name;
    if (email) student.email = email;
    if (year) student.year = year;
    if (photo !== undefined) student.photo = photo;

    // Cascade ID change logic safely
    if (regNo && regNo !== studentId) {
        student.id = regNo;
        
        // 1. Migrate biometrics
        if (db.faceDescriptors[studentId]) {
            db.faceDescriptors[regNo] = db.faceDescriptors[studentId];
            delete db.faceDescriptors[studentId];
        }

        // 2. Migrate attendance history
        db.attendanceRecords.forEach(r => {
            if (r.studentId === studentId) {
                r.studentId = regNo;
            }
        });
    }

    saveDb();
    res.json({ success: true, user: { ...student, role: 'student' } });
});

// ==== ATTENDANCE ====
app.post('/api/attendance/mark', (req, res) => {
    const { studentId, subject, status, period, dayOrder, time, date, year } = req.body;
    
    // Look for duplicate record
    const exists = db.attendanceRecords.find(r => 
        r.studentId === studentId && 
        r.date === date && 
        r.period === period
    );

    if (exists) {
        return res.status(400).json({ success: false, message: 'Attendance already marked.' });
    }

    const newRecord = { studentId, subject, status, period, dayOrder, time, date, year };
    db.attendanceRecords.push(newRecord);
    saveDb();

    res.json({ success: true, record: newRecord });
});

function evaluateAbsentRecords(student) {
    if(!student) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const key = `${student.year}_${db.dayOrder}`;
    const schedule = db.schedules[key];
    if(!schedule) return;

    let modified = false;
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    [1, 2, 3, 4, 5].forEach(pNum => {
        const slotKey = `p${pNum}`;
        const slot = schedule[slotKey];
        
        // Handle both older string format and new object format of slots
        const subject = typeof slot === 'object' ? slot.subject : slot;
        const endStr = typeof slot === 'object' ? slot.end : null;
        
        if(!subject || !endStr) return;

        const [eH, eM] = endStr.split(':').map(Number);
        const endMins = eH * 60 + eM;

        if (currentMins > endMins) {
            // Class has ended. Check if student has a record
            const exists = db.attendanceRecords.find(r => 
                r.studentId === student.id && 
                r.date === todayStr && 
                r.period === pNum
            );
            
            if(!exists) {
                // Generate automated Absent record
                db.attendanceRecords.push({
                    studentId: student.id,
                    subject: subject,
                    status: 'Absent',
                    period: pNum,
                    dayOrder: db.dayOrder,
                    time: '--:--',
                    date: todayStr,
                    year: student.year
                });
                modified = true;
            }
        }
    });
    
    if(modified) saveDb();
}

app.get('/api/attendance/student/:studentId', (req, res) => {
    const { studentId } = req.params;
    const student = db.students.find(s => s.id === studentId);
    if(student) evaluateAbsentRecords(student);

    const records = db.attendanceRecords.filter(r => r.studentId === studentId).sort((a,b) => new Date(b.date) - new Date(a.date));
    res.json({ success: true, records });
});

app.get('/api/attendance/records/:year', (req, res) => {
    const { year } = req.params;
    const { date } = req.query; // e.g. '2023-11-20'
    const today = date || new Date().toISOString().split('T')[0];

    // Build the stats and lists based on current date
    const isAll = (year === 'all' || !year);
    const yearStudents = isAll ? db.students : db.students.filter(s => s.year === year);
    const todaysRecords = isAll ? db.attendanceRecords.filter(r => r.date === today) : db.attendanceRecords.filter(r => r.year === year && r.date === today);

    // Get list of present, late, absent
    const presentList = todaysRecords.filter(r => r.status === 'Present');
    const lateList = todaysRecords.filter(r => r.status === 'Late');
    const presentStudentIds = todaysRecords.map(r => r.studentId);
    
    const absentList = yearStudents.filter(s => !presentStudentIds.includes(s.id));

    // Append names to present and late list
    const mappedPresent = presentList.map(r => {
        const student = yearStudents.find(s => s.id === r.studentId) || { name: 'Unknown', year: 'Unknown' };
        return { name: student.name, time: r.time, year: student.year };
    });
    const mappedLate = lateList.map(r => {
        const student = yearStudents.find(s => s.id === r.studentId) || { name: 'Unknown', year: 'Unknown' };
        return { name: student.name, time: r.time, year: student.year };
    });
    const mappedAbsent = absentList.map(s => ({ name: s.name, year: s.year }));

    res.json({ success: true, present: mappedPresent, late: mappedLate, absent: mappedAbsent });
});

app.get('/api/attendance/stats', (req, res) => {
    const { date } = req.query;
    const today = date || new Date().toISOString().split('T')[0];
    
    const todaysRecords = db.attendanceRecords.filter(r => r.date === today);
    const presentCount = todaysRecords.filter(r => r.status === 'Present').length;
    const lateCount = todaysRecords.filter(r => r.status === 'Late').length;
    const totalStudents = db.students.length;
    const absentCount = totalStudents - todaysRecords.length;

    res.json({
        success: true,
        stats: {
            present: presentCount,
            late: lateCount,
            absent: Math.max(0, absentCount),
            total: totalStudents
        }
    });
});

// Start server if run natively (like on Railway), otherwise export for serverless
if (require.main === module) {
    const port = process.env.PORT || 8080;
    app.listen(port, () => {
        console.log(`Railway Server running on port ${port}`);
    });
}

module.exports = app;
