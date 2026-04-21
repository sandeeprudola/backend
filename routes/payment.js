const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const zod = require('zod');

const Admin = require('../models/Admin');
const Emp = require('../models/Emp');
const Payment = require('../models/Payment');
const Sale = require('../models/Sale');
const { JWT_SECRET } = require('../config');

const router = express.Router();

const PAYMENT_WRITE_ROLES = ['admin', 'super-admin', 'receptionist'];
const PAYMENT_READ_ROLES = ['admin', 'super-admin', 'receptionist'];

const createPaymentSchema = zod.object({
    saleId: zod.string().trim().min(1),
    amount: zod.number().positive(),
    method: zod.enum(['cash', 'upi', 'card', 'bank-transfer', 'cheque', 'other']),
    referenceNumber: zod.string().trim().max(120).optional(),
    note: zod.string().trim().max(500).optional(),
    paidAt: zod.string().datetime().optional(),
});

function parseOptionalDate(value) {
    if (!value) {
        return undefined;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

async function paymentAccess(allowedRoles, req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Authorization token missing' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const subjectId = decoded.userId ?? decoded.userid ?? decoded.id;

        if (!allowedRoles.includes(decoded.role)) {
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

function canWritePayments(req, res, next) {
    return paymentAccess(PAYMENT_WRITE_ROLES, req, res, next);
}

function canReadPayments(req, res, next) {
    return paymentAccess(PAYMENT_READ_ROLES, req, res, next);
}

router.post('/', canWritePayments, async (req, res) => {
    try {
        const parsed = createPaymentSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                msg: 'invalid payment data',
                errors: parsed.error.flatten(),
            });
        }

        const data = parsed.data;
        if (!mongoose.Types.ObjectId.isValid(data.saleId)) {
            return res.status(400).json({ msg: 'invalid sale id' });
        }

        const sale = await Sale.findById(data.saleId);
        if (!sale) {
            return res.status(404).json({ msg: 'sale not found' });
        }

        if (sale.dueAmount <= 0) {
            return res.status(400).json({ msg: 'sale is already fully paid' });
        }

        if (data.amount > sale.dueAmount) {
            return res.status(400).json({ msg: 'payment amount cannot exceed due amount' });
        }

        const paidAt = parseOptionalDate(data.paidAt) || new Date();
        if (paidAt === null) {
            return res.status(400).json({ msg: 'invalid paidAt date' });
        }

        const paymentPayload = {
            patient: sale.patient,
            sale: sale._id,
            amount: data.amount,
            method: data.method,
            referenceNumber: data.referenceNumber,
            note: data.note,
            paidAt,
            collectedByRole: req.actor.role,
        };

        if (req.actor.type === 'admin') {
            paymentPayload.collectedByAdmin = req.actor.id;
        } else {
            paymentPayload.collectedByEmp = req.actor.id;
        }

        const payment = await Payment.create(paymentPayload);

        sale.paidAmount += data.amount;
        sale.dueAmount = Math.max(sale.finalAmount - sale.paidAmount, 0);
        await sale.save();

        await payment.populate([
            { path: 'patient', select: 'firstName lastName email' },
            { path: 'sale', select: 'brand model serialNumber finalAmount paidAmount dueAmount paymentMode' },
            { path: 'collectedByEmp', select: 'firstName lastName role' },
            { path: 'collectedByAdmin', select: 'firstName lastName role' },
        ]);

        return res.status(201).json({
            msg: 'payment recorded successfully',
            payment,
            sale,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to record payment',
            error: err.message,
        });
    }
});

router.get('/sale/:saleId', canReadPayments, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.saleId)) {
            return res.status(400).json({ msg: 'invalid sale id' });
        }

        const sale = await Sale.findById(req.params.saleId)
            .populate('patient', 'firstName lastName email')
            .populate('soldByEmp', 'firstName lastName role');
        if (!sale) {
            return res.status(404).json({ msg: 'sale not found' });
        }

        const payments = await Payment.find({ sale: sale._id })
            .sort({ paidAt: -1, createdAt: -1 })
            .populate('collectedByEmp', 'firstName lastName role')
            .populate('collectedByAdmin', 'firstName lastName role');

        return res.status(200).json({
            sale,
            payments,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch sale payments',
            error: err.message,
        });
    }
});

router.get('/patient/:patientId', canReadPayments, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.patientId)) {
            return res.status(400).json({ msg: 'invalid patient id' });
        }

        const payments = await Payment.find({ patient: req.params.patientId })
            .sort({ paidAt: -1, createdAt: -1 })
            .populate('sale', 'brand model serialNumber finalAmount paidAmount dueAmount paymentMode')
            .populate('collectedByEmp', 'firstName lastName role')
            .populate('collectedByAdmin', 'firstName lastName role');

        return res.status(200).json({ payments });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch patient payments',
            error: err.message,
        });
    }
});

module.exports = router;
