const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const zod = require('zod');

const Admin = require('../models/Admin');
const Emp = require('../models/Emp');
const Sale = require('../models/Sale');
const ServiceTicket = require('../models/ServiceTicket');
const User = require('../models/User');
const { JWT_SECRET } = require('../config');

const router = express.Router();

const READ_ROLES = ['admin', 'super-admin', 'receptionist', 'audiologist', 'therapist'];
const CREATE_ROLES = ['admin', 'super-admin', 'receptionist', 'audiologist'];
const UPDATE_ROLES = ['admin', 'super-admin', 'receptionist', 'audiologist', 'therapist'];

const createTicketSchema = zod.object({
    patientId: zod.string().trim().min(1),
    saleId: zod.string().trim().min(1).optional(),
    type: zod.enum(['repair', 'after-sale-service', 'annual-maintenance', 'fitting-followup', 'general-followup']),
    title: zod.string().trim().min(1).max(150),
    description: zod.string().trim().max(1500).optional(),
    priority: zod.enum(['low', 'normal', 'high', 'urgent']).optional(),
    assignedTo: zod.string().trim().min(1).optional(),
    dueDate: zod.string().datetime().optional(),
});

const updateTicketSchema = zod.object({
    status: zod.enum(['open', 'in-progress', 'resolved', 'cancelled']).optional(),
    assignedTo: zod.string().trim().min(1).optional(),
    priority: zod.enum(['low', 'normal', 'high', 'urgent']).optional(),
    dueDate: zod.string().datetime().optional(),
    serviceNotes: zod.string().trim().max(2000).optional(),
    note: zod.string().trim().max(500).optional(),
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

async function serviceAccess(allowedRoles, req, res, next) {
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

function canReadTickets(req, res, next) {
    return serviceAccess(READ_ROLES, req, res, next);
}

function canCreateTickets(req, res, next) {
    return serviceAccess(CREATE_ROLES, req, res, next);
}

function canUpdateTickets(req, res, next) {
    return serviceAccess(UPDATE_ROLES, req, res, next);
}

async function validateAssignableEmployee(employeeId) {
    if (!employeeId) {
        return null;
    }
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
        return { error: 'assignedTo must be a valid employee id' };
    }

    const employee = await Emp.findOne({
        _id: employeeId,
        role: { $in: ['audiologist', 'therapist', 'receptionist'] },
        isActive: true,
    }).select('_id');

    if (!employee) {
        return { error: 'assignedTo must be an active employee' };
    }

    return { employee };
}

router.post('/', canCreateTickets, async (req, res) => {
    try {
        const parsed = createTicketSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                msg: 'invalid service ticket data',
                errors: parsed.error.flatten(),
            });
        }

        const data = parsed.data;
        if (!mongoose.Types.ObjectId.isValid(data.patientId)) {
            return res.status(400).json({ msg: 'invalid patient id' });
        }

        const patient = await User.findById(data.patientId).select('_id firstName lastName email');
        if (!patient) {
            return res.status(404).json({ msg: 'patient not found' });
        }

        let sale = null;
        if (data.saleId) {
            if (!mongoose.Types.ObjectId.isValid(data.saleId)) {
                return res.status(400).json({ msg: 'invalid sale id' });
            }
            sale = await Sale.findOne({ _id: data.saleId, patient: patient._id }).select('_id brand model serialNumber');
            if (!sale) {
                return res.status(404).json({ msg: 'sale not found for this patient' });
            }
        }

        const assigned = await validateAssignableEmployee(data.assignedTo);
        if (assigned?.error) {
            return res.status(400).json({ msg: assigned.error });
        }

        const dueDate = parseOptionalDate(data.dueDate);
        if (dueDate === null) {
            return res.status(400).json({ msg: 'invalid due date' });
        }

        const ticketPayload = {
            patient: patient._id,
            sale: sale?._id,
            type: data.type,
            title: data.title,
            description: data.description,
            priority: data.priority || 'normal',
            assignedTo: assigned?.employee?._id,
            dueDate,
            createdByRole: req.actor.role,
            statusHistory: [
                {
                    status: 'open',
                    note: 'ticket created',
                    changedByRole: req.actor.role,
                },
            ],
        };

        if (req.actor.type === 'admin') {
            ticketPayload.createdByAdmin = req.actor.id;
            ticketPayload.statusHistory[0].changedByAdmin = req.actor.id;
        } else {
            ticketPayload.createdByEmp = req.actor.id;
            ticketPayload.statusHistory[0].changedByEmp = req.actor.id;
        }

        const ticket = await ServiceTicket.create(ticketPayload);
        await ticket.populate([
            { path: 'patient', select: 'firstName lastName email' },
            { path: 'sale', select: 'brand model serialNumber finalAmount paymentMode' },
            { path: 'assignedTo', select: 'firstName lastName role specialization' },
            { path: 'createdByEmp', select: 'firstName lastName role' },
            { path: 'createdByAdmin', select: 'firstName lastName role' },
        ]);

        return res.status(201).json({
            msg: 'service ticket created successfully',
            ticket,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to create service ticket',
            error: err.message,
        });
    }
});

router.get('/patient/:patientId', canReadTickets, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.patientId)) {
            return res.status(400).json({ msg: 'invalid patient id' });
        }

        const { status, type } = req.query;
        const query = { patient: req.params.patientId };
        if (status) {
            query.status = status;
        }
        if (type) {
            query.type = type;
        }

        const tickets = await ServiceTicket.find(query)
            .sort({ createdAt: -1 })
            .populate('patient', 'firstName lastName email')
            .populate('sale', 'brand model serialNumber finalAmount paymentMode')
            .populate('assignedTo', 'firstName lastName role specialization')
            .populate('createdByEmp', 'firstName lastName role')
            .populate('createdByAdmin', 'firstName lastName role');

        return res.status(200).json({ tickets });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch patient service tickets',
            error: err.message,
        });
    }
});

router.put('/:id/status', canUpdateTickets, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ msg: 'invalid service ticket id' });
        }

        const parsed = updateTicketSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                msg: 'invalid service ticket update data',
                errors: parsed.error.flatten(),
            });
        }

        const ticket = await ServiceTicket.findById(req.params.id);
        if (!ticket) {
            return res.status(404).json({ msg: 'service ticket not found' });
        }

        const data = parsed.data;
        if (data.assignedTo) {
            const assigned = await validateAssignableEmployee(data.assignedTo);
            if (assigned?.error) {
                return res.status(400).json({ msg: assigned.error });
            }
            ticket.assignedTo = assigned.employee._id;
        }

        if (data.priority) {
            ticket.priority = data.priority;
        }

        if (data.dueDate) {
            const dueDate = parseOptionalDate(data.dueDate);
            if (dueDate === null) {
                return res.status(400).json({ msg: 'invalid due date' });
            }
            ticket.dueDate = dueDate;
        }

        if (data.serviceNotes) {
            ticket.serviceNotes = data.serviceNotes;
        }

        if (data.status) {
            ticket.status = data.status;
            ticket.statusHistory.push({
                status: data.status,
                note: data.note,
                changedByRole: req.actor.role,
                changedByEmp: req.actor.type === 'employee' ? req.actor.id : undefined,
                changedByAdmin: req.actor.type === 'admin' ? req.actor.id : undefined,
            });

            if (data.status === 'resolved') {
                ticket.completedAt = new Date();
            }
            if (data.status !== 'resolved') {
                ticket.completedAt = undefined;
            }
        }

        await ticket.save();
        await ticket.populate([
            { path: 'patient', select: 'firstName lastName email' },
            { path: 'sale', select: 'brand model serialNumber finalAmount paymentMode' },
            { path: 'assignedTo', select: 'firstName lastName role specialization' },
            { path: 'createdByEmp', select: 'firstName lastName role' },
            { path: 'createdByAdmin', select: 'firstName lastName role' },
        ]);

        return res.status(200).json({
            msg: 'service ticket updated successfully',
            ticket,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to update service ticket',
            error: err.message,
        });
    }
});

module.exports = router;
