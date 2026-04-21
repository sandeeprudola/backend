const express = require('express');
const jwt = require('jsonwebtoken');

const Admin = require('../models/Admin');
const Appointment = require('../models/Appointment');
const Emp = require('../models/Emp');
const Payment = require('../models/Payment');
const Sale = require('../models/Sale');
const User = require('../models/User');
const { JWT_SECRET } = require('../config');

const router = express.Router();

const REPORT_ROLES = ['admin', 'super-admin', 'receptionist'];

function monthRange(year, month) {
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return { start, end };
}

async function reportAccess(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Authorization token missing' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const subjectId = decoded.userId ?? decoded.userid ?? decoded.id;

        if (!REPORT_ROLES.includes(decoded.role)) {
            return res.status(403).json({ msg: 'Forbidden: insufficient role' });
        }

        if (decoded.role === 'admin' || decoded.role === 'super-admin') {
            const admin = await Admin.findById(subjectId).select('_id role');
            if (!admin) {
                return res.status(401).json({ msg: 'Admin not found' });
            }
            return next();
        }

        const employee = await Emp.findById(subjectId).select('_id role isActive');
        if (!employee || !employee.isActive) {
            return res.status(403).json({ msg: 'Employee not found or inactive' });
        }

        return next();
    } catch (err) {
        return res.status(401).json({
            msg: 'Invalid or expired token',
            error: err.message,
        });
    }
}

router.get('/monthly', reportAccess, async (req, res) => {
    try {
        const now = new Date();
        const year = parseInt(req.query.year || String(now.getUTCFullYear()), 10);
        const month = parseInt(req.query.month || String(now.getUTCMonth() + 1), 10);

        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
            return res.status(400).json({ msg: 'provide valid year and month' });
        }

        const { start, end } = monthRange(year, month);

        const [
            revenueAgg,
            paymentsByMethod,
            newPatients,
            salesCount,
            appointmentCount,
            completedAppointmentCount,
            saleAmountAgg,
        ] = await Promise.all([
            Payment.aggregate([
                { $match: { paidAt: { $gte: start, $lte: end } } },
                { $group: { _id: null, totalRevenue: { $sum: '$amount' }, paymentCount: { $sum: 1 } } },
            ]),
            Payment.aggregate([
                { $match: { paidAt: { $gte: start, $lte: end } } },
                { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } },
                { $project: { _id: 0, method: '$_id', total: 1, count: 1 } },
                { $sort: { total: -1 } },
            ]),
            User.countDocuments({ _id: { $exists: true }, createdAt: { $gte: start, $lte: end } }),
            Sale.countDocuments({ saleDate: { $gte: start, $lte: end } }),
            Appointment.countDocuments({ appointmentdate: { $gte: start, $lte: end } }),
            Appointment.countDocuments({ appointmentdate: { $gte: start, $lte: end }, status: 'completed' }),
            Sale.aggregate([
                { $match: { saleDate: { $gte: start, $lte: end } } },
                { $group: { _id: null, totalSalesValue: { $sum: '$finalAmount' }, totalDue: { $sum: '$dueAmount' }, totalPaidOnSales: { $sum: '$paidAmount' } } },
            ]),
        ]);

        const totalRevenue = revenueAgg[0]?.totalRevenue || 0;
        const paymentCount = revenueAgg[0]?.paymentCount || 0;
        const totalSalesValue = saleAmountAgg[0]?.totalSalesValue || 0;
        const totalDue = saleAmountAgg[0]?.totalDue || 0;
        const totalPaidOnSales = saleAmountAgg[0]?.totalPaidOnSales || 0;

        return res.status(200).json({
            range: { from: start, to: end, year, month },
            revenue: {
                totalRevenue,
                paymentCount,
                paymentsByMethod,
                totalSalesValue,
                totalPaidOnSales,
                totalDue,
            },
            conversion: {
                note: 'Lead model is not built yet, so conversion is calculated using available data.',
                newPatients,
                salesCount,
                appointmentCount,
                completedAppointmentCount,
                patientToSaleRate: newPatients ? Number(((salesCount / newPatients) * 100).toFixed(2)) : 0,
                appointmentToSaleRate: appointmentCount ? Number(((salesCount / appointmentCount) * 100).toFixed(2)) : 0,
                completedAppointmentToSaleRate: completedAppointmentCount ? Number(((salesCount / completedAppointmentCount) * 100).toFixed(2)) : 0,
            },
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch monthly report',
            error: err.message,
        });
    }
});

module.exports = router;
