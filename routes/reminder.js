const express = require('express');
const jwt = require('jsonwebtoken');

const Admin = require('../models/Admin');
const Emp = require('../models/Emp');
const PatientProfile = require('../models/PatientProfile');
const Sale = require('../models/Sale');
const ServiceTicket = require('../models/ServiceTicket');
const { JWT_SECRET } = require('../config');

const router = express.Router();

const REMINDER_ROLES = ['admin', 'super-admin', 'receptionist', 'audiologist', 'therapist'];

function getDayRange(dateLike) {
    const start = dateLike ? new Date(dateLike) : new Date();
    if (Number.isNaN(start.getTime())) {
        return null;
    }

    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

async function reminderAccess(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Authorization token missing' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const subjectId = decoded.userId ?? decoded.userid ?? decoded.id;

        if (!REMINDER_ROLES.includes(decoded.role)) {
            return res.status(403).json({ msg: 'Forbidden: insufficient role' });
        }

        if (decoded.role === 'admin' || decoded.role === 'super-admin') {
            const admin = await Admin.findById(subjectId).select('_id role firstName lastName');
            if (!admin) {
                return res.status(401).json({ msg: 'Admin not found' });
            }

            req.actor = {
                type: 'admin',
                id: admin._id,
                role: admin.role,
            };
            return next();
        }

        const employee = await Emp.findById(subjectId).select('_id role firstName lastName isActive');
        if (!employee || !employee.isActive) {
            return res.status(403).json({ msg: 'Employee not found or inactive' });
        }

        req.actor = {
            type: 'employee',
            id: employee._id,
            role: employee.role,
        };
        return next();
    } catch (err) {
        return res.status(401).json({
            msg: 'Invalid or expired token',
            error: err.message,
        });
    }
}

router.get('/today', reminderAccess, async (req, res) => {
    try {
        const range = getDayRange(req.query.date);
        if (!range) {
            return res.status(400).json({ msg: 'invalid date' });
        }

        const [patientFollowUps, serviceTickets, amcReminders, warrantyReminders, emiReminders] = await Promise.all([
            PatientProfile.find({
                nextFollowUpDate: { $gte: range.start, $lte: range.end },
                caseStatus: { $ne: 'completed' },
            })
                .populate('user', 'firstName lastName email role')
                .populate('assignedTherapist', 'firstName lastName role specialization')
                .populate('assignedAudiologist', 'firstName lastName role specialization')
                .sort({ nextFollowUpDate: 1 }),

            ServiceTicket.find({
                dueDate: { $gte: range.start, $lte: range.end },
                status: { $nin: ['resolved', 'cancelled'] },
            })
                .populate('patient', 'firstName lastName email role')
                .populate('sale', 'brand model serialNumber')
                .populate('assignedTo', 'firstName lastName role specialization')
                .sort({ dueDate: 1 }),

            Sale.find({
                amcExpiryDate: { $gte: range.start, $lte: range.end },
            })
                .populate('patient', 'firstName lastName email role')
                .populate('soldByEmp', 'firstName lastName role')
                .sort({ amcExpiryDate: 1 }),

            Sale.find({
                warrantyExpiryDate: { $gte: range.start, $lte: range.end },
            })
                .populate('patient', 'firstName lastName email role')
                .populate('soldByEmp', 'firstName lastName role')
                .sort({ warrantyExpiryDate: 1 }),

            Sale.find({
                paymentMode: 'emi',
                dueAmount: { $gt: 0 },
                'emiPlan.nextDueDate': { $gte: range.start, $lte: range.end },
            })
                .populate('patient', 'firstName lastName email role')
                .populate('soldByEmp', 'firstName lastName role')
                .sort({ 'emiPlan.nextDueDate': 1 }),
        ]);

        return res.status(200).json({
            date: range.start.toISOString().slice(0, 10),
            range: {
                from: range.start,
                to: range.end,
            },
            summary: {
                patientFollowUps: patientFollowUps.length,
                serviceTickets: serviceTickets.length,
                amcReminders: amcReminders.length,
                warrantyReminders: warrantyReminders.length,
                emiReminders: emiReminders.length,
            },
            patientFollowUps,
            serviceTickets,
            amcReminders,
            warrantyReminders,
            emiReminders,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch reminders',
            error: err.message,
        });
    }
});

module.exports = router;
