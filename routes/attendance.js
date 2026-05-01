const express = require('express');
const router = express.Router();

const Attendance = require('../models/Attendance');
const Emp = require('../models/Emp');
const authmiddleware = require('../middlewares/authmiddleware'); // for staff (employees)
const adminAuth = require('../middlewares/adminAuth'); // for admins

// helper to normalise a date to start-of-day
function startOfDay(dateLike) {
    const d = dateLike ? new Date(dateLike) : new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(dateLike) {
    const d = dateLike ? new Date(dateLike) : new Date();
    d.setHours(23, 59, 59, 999);
    return d;
}

function parsePagination(req) {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    return { page, limit, skip: (page - 1) * limit };
}

router.get('/admin/list', adminAuth, async (req, res) => {
    try {
        const { page, limit, skip } = parsePagination(req);
        const { employeeId, status, from, to, q } = req.query;

        const query = {};
        if (employeeId) query.employee = employeeId;
        if (status) query.status = status;
        if (from || to) {
            query.date = Object.assign(
                {},
                from && { $gte: startOfDay(from) },
                to && { $lte: endOfDay(to) },
            );
        }

        let employeeIds;
        if (q) {
            const employees = await Emp.find({
                $or: [
                    { firstName: { $regex: q, $options: 'i' } },
                    { lastName: { $regex: q, $options: 'i' } },
                    { email: { $regex: q, $options: 'i' } },
                    { username: { $regex: q, $options: 'i' } },
                    { role: { $regex: q, $options: 'i' } },
                    { specialization: { $regex: q, $options: 'i' } },
                ],
            }).select('_id');
            employeeIds = employees.map((employee) => employee._id);
            query.employee = employeeId
                ? employeeId
                : { $in: employeeIds };
        }

        const todayStart = startOfDay();
        const todayEnd = endOfDay();

        const [items, total, todayRecords, activeEmployees] = await Promise.all([
            Attendance.find(query)
                .sort({ date: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('employee', 'firstName lastName email role specialization isActive')
                .populate('overriddenBy', 'firstName lastName role'),
            Attendance.countDocuments(query),
            Attendance.find({ date: { $gte: todayStart, $lte: todayEnd } })
                .populate('employee', 'firstName lastName email role specialization isActive')
                .sort({ checkInTime: -1, createdAt: -1 }),
            Emp.find({ isActive: true })
                .select('firstName lastName email role specialization isActive')
                .sort({ firstName: 1, lastName: 1 }),
        ]);

        const todayByEmployee = new Map(
            todayRecords
                .filter((record) => record.employee)
                .map((record) => [record.employee._id.toString(), record]),
        );

        const todayStatus = activeEmployees.map((employee) => {
            const record = todayByEmployee.get(employee._id.toString());
            return {
                employee,
                attendance: record || null,
                status: record?.status || 'not-marked',
                checkInTime: record?.checkInTime,
                checkOutTime: record?.checkOutTime,
            };
        });

        const presentToday = todayStatus.filter((item) => item.status === 'present').length;
        const absentToday = todayStatus.filter((item) => item.status === 'absent').length;
        const notMarkedToday = todayStatus.filter((item) => item.status === 'not-marked').length;

        return res.status(200).json({
            page,
            limit,
            total,
            items,
            todayStatus,
            summary: {
                activeEmployees: activeEmployees.length,
                presentToday,
                absentToday,
                notMarkedToday,
            },
        });
    } catch (err) {
        console.error('Admin attendance list error:', err);
        return res.status(500).json({ msg: 'failed to fetch attendance', error: err.message });
    }
});

/**
 * Employee check-in
 * Requires staff token (therapist / audiologist / receptionist)
 * Uses req.user.id as the employee (Emp) id
 */
router.post('/checkin', authmiddleware(['therapist', 'audiologist', 'receptionist']), async (req, res) => {
    try {
        const employeeId = req.user.id;
        const date = startOfDay(req.body.date);

        // Ensure the employee exists
        const employee = await Emp.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ msg: 'employee not found' });
        }

        let attendance = await Attendance.findOne({ employee: employeeId, date });

        if (attendance && attendance.checkInTime) {
            return res.status(400).json({ msg: 'already checked in for this day' });
        }

        const now = new Date();

        if (!attendance) {
            attendance = new Attendance({
                employee: employeeId,
                date,
                checkInTime: now,
                status: 'present',
            });
        } else {
            attendance.checkInTime = now;
            attendance.status = 'present';
        }

        await attendance.save();
        return res.status(200).json({
            msg: 'check-in recorded',
            attendance,
        });
    } catch (err) {
        console.error('Check-in error:', err);
        return res.status(500).json({ msg: 'failed to check in', error: err.message });
    }
});

/**
 * Employee check-out
 * Requires staff token
 */
router.post('/checkout', authmiddleware(['therapist', 'audiologist', 'receptionist']), async (req, res) => {
    try {
        const employeeId = req.user.id;
        const date = startOfDay(req.body.date);

        const attendance = await Attendance.findOne({ employee: employeeId, date });

        if (!attendance || !attendance.checkInTime) {
            return res.status(400).json({ msg: 'no check-in found for this day' });
        }

        if (attendance.checkOutTime) {
            return res.status(400).json({ msg: 'already checked out for this day' });
        }

        attendance.checkOutTime = new Date();
        await attendance.save();

        return res.status(200).json({
            msg: 'check-out recorded',
            attendance,
        });
    } catch (err) {
        console.error('Check-out error:', err);
        return res.status(500).json({ msg: 'failed to check out', error: err.message });
    }
});

/**
 * Admin: mark employee absent for a given day
 * Body: { employeeId, date, reason }
 */
router.post('/admin/mark-absent', adminAuth, async (req, res) => {
    try {
        const { employeeId, date, reason } = req.body;
        if (!employeeId) {
            return res.status(400).json({ msg: 'employeeId is required' });
        }

        const day = startOfDay(date);

        const employee = await Emp.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ msg: 'employee not found' });
        }

        const attendance = await Attendance.findOneAndUpdate(
            { employee: employeeId, date: day },
            {
                $set: {
                    status: 'absent',
                    checkInTime: null,
                    checkOutTime: null,
                    isOverriddenByAdmin: true,
                    overriddenBy: req.admin._id,
                    overrideReason: reason || 'marked absent by admin',
                },
                $push: reason
                    ? {
                        correctionNotes: {
                            note: reason,
                            correctedBy: req.admin._id,
                        },
                    }
                    : {},
            },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true,
            }
        );

        return res.status(200).json({
            msg: 'attendance marked as absent',
            attendance,
        });
    } catch (err) {
        console.error('Mark-absent error:', err);
        return res.status(500).json({ msg: 'failed to mark absent', error: err.message });
    }
});

/**
 * Admin: correct an existing attendance record
 * Params: :id (attendance id)
 * Body (all optional): { status, checkInTime, checkOutTime, overrideReason, note }
 */
router.put('/admin/attendance/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, checkInTime, checkOutTime, overrideReason, note } = req.body || {};

        const attendance = await Attendance.findById(id);
        if (!attendance) {
            return res.status(404).json({ msg: 'attendance record not found' });
        }

        if (status) {
            attendance.status = status;
        }
        if (checkInTime) {
            attendance.checkInTime = new Date(checkInTime);
        }
        if (checkOutTime) {
            attendance.checkOutTime = new Date(checkOutTime);
        }
        if (overrideReason) {
            attendance.overrideReason = overrideReason;
        }

        attendance.isOverriddenByAdmin = true;
        attendance.overriddenBy = req.admin._id;

        if (note) {
            attendance.correctionNotes.push({
                note,
                correctedBy: req.admin._id,
            });
        }

        await attendance.save();

        return res.status(200).json({
            msg: 'attendance corrected by admin',
            attendance,
        });
    } catch (err) {
        console.error('Attendance correction error:', err);
        return res.status(500).json({ msg: 'failed to correct attendance', error: err.message });
    }
});

module.exports = router;
