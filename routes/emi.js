const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const zod = require('zod');

const Admin = require('../models/Admin');
const EmiInstallment = require('../models/EmiInstallment');
const Emp = require('../models/Emp');
const Payment = require('../models/Payment');
const Sale = require('../models/Sale');
const { JWT_SECRET } = require('../config');

const router = express.Router();

const EMI_WRITE_ROLES = ['admin', 'super-admin', 'receptionist'];
const EMI_READ_ROLES = ['admin', 'super-admin', 'receptionist', 'audiologist'];

const generateEmiSchema = zod.object({
    startDate: zod.string().datetime().optional(),
    installmentAmount: zod.number().positive().optional(),
    totalInstallments: zod.number().int().min(1).optional(),
});

const payInstallmentSchema = zod.object({
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

function addMonths(date, monthsToAdd) {
    const result = new Date(date);
    result.setMonth(result.getMonth() + monthsToAdd);
    return result;
}

async function emiAccess(allowedRoles, req, res, next) {
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

function canReadEmi(req, res, next) {
    return emiAccess(EMI_READ_ROLES, req, res, next);
}

function canWriteEmi(req, res, next) {
    return emiAccess(EMI_WRITE_ROLES, req, res, next);
}

router.post('/sale/:saleId/generate', canWriteEmi, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.saleId)) {
            return res.status(400).json({ msg: 'invalid sale id' });
        }

        const parsed = generateEmiSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                msg: 'invalid emi generation data',
                errors: parsed.error.flatten(),
            });
        }

        const sale = await Sale.findById(req.params.saleId);
        if (!sale) {
            return res.status(404).json({ msg: 'sale not found' });
        }

        if (sale.paymentMode !== 'emi') {
            return res.status(400).json({ msg: 'sale payment mode is not emi' });
        }

        if (sale.dueAmount <= 0) {
            return res.status(400).json({ msg: 'sale has no due amount' });
        }

        const existingCount = await EmiInstallment.countDocuments({ sale: sale._id });
        if (existingCount > 0) {
            return res.status(409).json({ msg: 'emi installments already generated for this sale' });
        }

        const startDate = parseOptionalDate(parsed.data.startDate) || sale.emiPlan?.nextDueDate || new Date();
        if (startDate === null) {
            return res.status(400).json({ msg: 'invalid start date' });
        }

        const totalInstallments = parsed.data.totalInstallments || sale.emiPlan?.totalInstallments;
        if (!totalInstallments) {
            return res.status(400).json({ msg: 'totalInstallments is required' });
        }

        const defaultAmount = parsed.data.installmentAmount || sale.emiPlan?.installmentAmount || Math.ceil(sale.dueAmount / totalInstallments);
        const installments = [];
        let remaining = sale.dueAmount;

        for (let i = 1; i <= totalInstallments; i += 1) {
            const amount = i === totalInstallments ? remaining : Math.min(defaultAmount, remaining);
            installments.push({
                patient: sale.patient,
                sale: sale._id,
                installmentNumber: i,
                amount,
                dueDate: addMonths(startDate, i - 1),
            });
            remaining -= amount;
        }

        const created = await EmiInstallment.insertMany(installments);

        return res.status(201).json({
            msg: 'emi installments generated successfully',
            installments: created,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to generate emi installments',
            error: err.message,
        });
    }
});

router.get('/sale/:saleId', canReadEmi, async (req, res) => {
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

        const installments = await EmiInstallment.find({ sale: sale._id })
            .sort({ installmentNumber: 1 })
            .populate('payment', 'amount method referenceNumber paidAt');

        return res.status(200).json({ sale, installments });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch emi installments',
            error: err.message,
        });
    }
});

router.get('/patient/:patientId', canReadEmi, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.patientId)) {
            return res.status(400).json({ msg: 'invalid patient id' });
        }

        const installments = await EmiInstallment.find({ patient: req.params.patientId })
            .sort({ dueDate: 1 })
            .populate('sale', 'brand model serialNumber finalAmount paidAmount dueAmount paymentMode')
            .populate('payment', 'amount method referenceNumber paidAt');

        return res.status(200).json({ installments });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch patient emi installments',
            error: err.message,
        });
    }
});

router.put('/installments/:id/pay', canWriteEmi, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ msg: 'invalid installment id' });
        }

        const parsed = payInstallmentSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                msg: 'invalid installment payment data',
                errors: parsed.error.flatten(),
            });
        }

        const installment = await EmiInstallment.findById(req.params.id);
        if (!installment) {
            return res.status(404).json({ msg: 'emi installment not found' });
        }

        if (installment.status === 'paid') {
            return res.status(400).json({ msg: 'emi installment is already paid' });
        }

        const sale = await Sale.findById(installment.sale);
        if (!sale) {
            return res.status(404).json({ msg: 'sale not found' });
        }

        if (installment.amount > sale.dueAmount) {
            return res.status(400).json({ msg: 'installment amount cannot exceed sale due amount' });
        }

        const paidAt = parseOptionalDate(parsed.data.paidAt) || new Date();
        if (paidAt === null) {
            return res.status(400).json({ msg: 'invalid paidAt date' });
        }

        const paymentPayload = {
            patient: installment.patient,
            sale: sale._id,
            amount: installment.amount,
            method: parsed.data.method,
            referenceNumber: parsed.data.referenceNumber,
            note: parsed.data.note || `EMI installment ${installment.installmentNumber} payment`,
            paidAt,
            collectedByRole: req.actor.role,
        };

        if (req.actor.type === 'admin') {
            paymentPayload.collectedByAdmin = req.actor.id;
        } else {
            paymentPayload.collectedByEmp = req.actor.id;
        }

        const payment = await Payment.create(paymentPayload);

        sale.paidAmount += installment.amount;
        sale.dueAmount = Math.max(sale.finalAmount - sale.paidAmount, 0);
        await sale.save();

        installment.status = 'paid';
        installment.paidAt = paidAt;
        installment.payment = payment._id;
        installment.note = parsed.data.note;
        await installment.save();

        const nextPendingInstallment = await EmiInstallment.findOne({
            sale: sale._id,
            status: { $in: ['pending', 'overdue'] },
        }).sort({ dueDate: 1, installmentNumber: 1 });

        if (sale.emiPlan) {
            sale.emiPlan.nextDueDate = nextPendingInstallment ? nextPendingInstallment.dueDate : undefined;
            await sale.save();
        }

        await installment.populate([
            { path: 'sale', select: 'brand model serialNumber finalAmount paidAmount dueAmount paymentMode' },
            { path: 'payment', select: 'amount method referenceNumber paidAt' },
        ]);

        return res.status(200).json({
            msg: 'emi installment paid successfully',
            installment,
            payment,
            sale,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to pay emi installment',
            error: err.message,
        });
    }
});

module.exports = router;
