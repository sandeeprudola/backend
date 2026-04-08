const express = require('express');
const zod = require('zod');

const Sale = require('../models/Sale');
const User = require('../models/User');
const Emp = require('../models/Emp');
const authmiddleware = require('../middlewares/authmiddleware');

const router = express.Router();

const createSaleSchema = zod.object({
    patientId: zod.string().trim().min(1),
    brand: zod.string().trim().min(1).max(80),
    model: zod.string().trim().min(1).max(120),
    serialNumber: zod.string().trim().max(120).optional(),
    side: zod.enum(['left', 'right', 'both']),
    saleDate: zod.string().datetime().optional(),
    saleAmount: zod.number().nonnegative(),
    discount: zod.number().nonnegative().optional(),
    tax: zod.number().nonnegative().optional(),
    paymentMode: zod.enum(['full', 'emi']),
    paidAmount: zod.number().nonnegative().optional(),
    warrantyExpiryDate: zod.string().datetime().optional(),
    amcExpiryDate: zod.string().datetime().optional(),
    fittingDate: zod.string().datetime().optional(),
    notes: zod.string().trim().max(1000).optional(),
    emiPlan: zod
        .object({
            downPayment: zod.number().nonnegative().optional(),
            installmentAmount: zod.number().positive(),
            totalInstallments: zod.number().int().min(1),
            nextDueDate: zod.string().datetime(),
        })
        .optional(),
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

router.post('/', authmiddleware(['receptionist']), async (req, res) => {
    try {
        const parsed = createSaleSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                msg: 'invalid sale data',
                errors: parsed.error.flatten(),
            });
        }

        const data = parsed.data;
        const [patient, employee] = await Promise.all([
            User.findById(data.patientId).select('_id firstName lastName email'),
            Emp.findById(req.user.id).select('_id role firstName lastName'),
        ]);

        if (!patient) {
            return res.status(404).json({ msg: 'patient not found' });
        }

        if (!employee) {
            return res.status(403).json({ msg: 'employee not found for token' });
        }

        const saleDate = parseOptionalDate(data.saleDate) || new Date();
        const warrantyExpiryDate = parseOptionalDate(data.warrantyExpiryDate);
        const amcExpiryDate = parseOptionalDate(data.amcExpiryDate);
        const fittingDate = parseOptionalDate(data.fittingDate);
        const emiNextDueDate = parseOptionalDate(data.emiPlan?.nextDueDate);

        if ([warrantyExpiryDate, amcExpiryDate, fittingDate, emiNextDueDate].includes(null)) {
            return res.status(400).json({ msg: 'one or more provided dates are invalid' });
        }

        const discount = data.discount ?? 0;
        const tax = data.tax ?? 0;
        const paidAmount = data.paidAmount ?? 0;
        const finalAmount = data.saleAmount - discount + tax;

        if (finalAmount < 0) {
            return res.status(400).json({ msg: 'final amount cannot be negative' });
        }

        if (paidAmount > finalAmount) {
            return res.status(400).json({ msg: 'paid amount cannot exceed final amount' });
        }

        if (data.paymentMode === 'emi' && !data.emiPlan) {
            return res.status(400).json({ msg: 'emi plan is required when payment mode is emi' });
        }

        if (data.paymentMode === 'full' && data.emiPlan) {
            return res.status(400).json({ msg: 'emi plan is only allowed when payment mode is emi' });
        }

        const dueAmount = finalAmount - paidAmount;
        const sale = await Sale.create({
            patient: patient._id,
            brand: data.brand,
            model: data.model,
            serialNumber: data.serialNumber,
            side: data.side,
            saleDate,
            saleAmount: data.saleAmount,
            discount,
            tax,
            finalAmount,
            paymentMode: data.paymentMode,
            paidAmount,
            dueAmount,
            warrantyExpiryDate,
            amcExpiryDate,
            fittingDate,
            notes: data.notes,
            emiPlan: data.emiPlan
                ? {
                    downPayment: data.emiPlan.downPayment ?? paidAmount,
                    installmentAmount: data.emiPlan.installmentAmount,
                    totalInstallments: data.emiPlan.totalInstallments,
                    nextDueDate: emiNextDueDate,
                }
                : undefined,
            soldByEmp: employee._id,
        });

        await sale.populate([
            { path: 'patient', select: 'firstName lastName email' },
            { path: 'soldByEmp', select: 'firstName lastName role' },
        ]);

        return res.status(201).json({
            msg: 'sale created successfully',
            sale,
        });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ msg: 'serial number already exists' });
        }

        return res.status(500).json({
            msg: 'failed to create sale',
            error: err.message,
        });
    }
});

router.get('/patient/:patientId', authmiddleware(['receptionist', 'audiologist']), async (req, res) => {
    try {
        const patient = await User.findById(req.params.patientId).select('_id firstName lastName email');
        if (!patient) {
            return res.status(404).json({ msg: 'patient not found' });
        }

        const sales = await Sale.find({ patient: patient._id })
            .sort({ saleDate: -1, createdAt: -1 })
            .populate('patient', 'firstName lastName email')
            .populate('soldByEmp', 'firstName lastName role');

        return res.status(200).json({
            patient,
            sales,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch patient sales',
            error: err.message,
        });
    }
});

module.exports = router;
