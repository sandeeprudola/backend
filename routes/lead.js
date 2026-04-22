const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const zod = require('zod');

const Admin = require('../models/Admin');
const Emp = require('../models/Emp');
const Lead = require('../models/Lead');
const PatientProfile = require('../models/PatientProfile');
const User = require('../models/User');
const { JWT_SECRET } = require('../config');

const router = express.Router();

const READ_ROLES = ['admin', 'super-admin', 'receptionist', 'audiologist', 'therapist'];
const WRITE_ROLES = ['admin', 'super-admin', 'receptionist'];

const leadSchema = zod.object({
    firstName: zod.string().trim().min(1).max(50),
    lastName: zod.string().trim().max(50).optional(),
    phone: zod.string().trim().min(5).max(20),
    email: zod.string().trim().email().optional(),
    interest: zod.enum(['hearing', 'speech', 'both', 'other']),
    source: zod.enum(['walk-in', 'phone-call', 'website', 'referral', 'instagram', 'facebook', 'camp', 'other']).optional(),
    status: zod.enum(['new', 'contacted', 'follow-up', 'converted', 'lost']).optional(),
    assignedTo: zod.string().trim().min(1).optional(),
    nextFollowUpDate: zod.string().datetime().optional(),
    notes: zod.string().trim().max(1500).optional(),
    lostReason: zod.string().trim().max(500).optional(),
});

const updateLeadSchema = leadSchema.partial();

const convertLeadSchema = zod.object({
    username: zod.string().trim().min(3).max(30).optional(),
    email: zod.string().trim().email().optional(),
    password: zod.string().min(6).optional(),
    role: zod.enum(['hearing', 'speech', 'both']).optional(),
    HearingServices: zod.enum(['None', 'a', 'b', 'c']).optional(),
    SpeechServices: zod.enum(['None', 'a', 'b', 'c']).optional(),
});

function parsePagination(req) {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 100);
    return { page, limit, skip: (page - 1) * limit };
}

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

async function leadAccess(allowedRoles, req, res, next) {
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
            req.actor = { type: 'admin', id: admin._id, role: admin.role };
            return next();
        }

        const employee = await Emp.findById(subjectId).select('_id role firstName lastName isActive');
        if (!employee || !employee.isActive) {
            return res.status(403).json({ msg: 'Employee not found or inactive' });
        }
        req.actor = { type: 'employee', id: employee._id, role: employee.role };
        return next();
    } catch (err) {
        return res.status(401).json({ msg: 'Invalid or expired token', error: err.message });
    }
}

function canReadLeads(req, res, next) {
    return leadAccess(READ_ROLES, req, res, next);
}

function canWriteLeads(req, res, next) {
    return leadAccess(WRITE_ROLES, req, res, next);
}

async function validateAssignedEmployee(assignedTo) {
    if (!assignedTo) {
        return null;
    }
    if (!mongoose.Types.ObjectId.isValid(assignedTo)) {
        return 'assignedTo must be a valid employee id';
    }

    const employee = await Emp.findOne({
        _id: assignedTo,
        role: { $in: ['receptionist', 'audiologist', 'therapist'] },
        isActive: true,
    }).select('_id');

    if (!employee) {
        return 'assignedTo must be an active employee';
    }

    return null;
}

function actorPayload(actor) {
    return actor.type === 'admin'
        ? { createdByAdmin: actor.id, createdByRole: actor.role }
        : { createdByEmp: actor.id, createdByRole: actor.role };
}

function leadInterestToPatientRole(interest) {
    if (interest === 'hearing' || interest === 'speech' || interest === 'both') {
        return interest;
    }
    return 'hearing';
}

function makeUsername(lead) {
    const base = `${lead.firstName}${lead.phone.slice(-4)}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    return base || `patient${Date.now()}`;
}

router.post('/', canWriteLeads, async (req, res) => {
    try {
        const parsed = leadSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ msg: 'invalid lead data', errors: parsed.error.flatten() });
        }

        const data = parsed.data;
        const assignedError = await validateAssignedEmployee(data.assignedTo);
        if (assignedError) {
            return res.status(400).json({ msg: assignedError });
        }

        const nextFollowUpDate = parseOptionalDate(data.nextFollowUpDate);
        if (nextFollowUpDate === null) {
            return res.status(400).json({ msg: 'invalid nextFollowUpDate' });
        }

        const lead = await Lead.create({
            ...data,
            source: data.source || 'other',
            status: data.status || 'new',
            nextFollowUpDate,
            ...actorPayload(req.actor),
        });

        await lead.populate([
            { path: 'assignedTo', select: 'firstName lastName role specialization' },
            { path: 'createdByEmp', select: 'firstName lastName role' },
            { path: 'createdByAdmin', select: 'firstName lastName role' },
        ]);

        return res.status(201).json({ msg: 'lead created successfully', lead });
    } catch (err) {
        return res.status(500).json({ msg: 'failed to create lead', error: err.message });
    }
});

router.get('/', canReadLeads, async (req, res) => {
    try {
        const { page, limit, skip } = parsePagination(req);
        const { status, source, interest, assignedTo, q } = req.query;
        const query = {};

        if (status) query.status = status;
        if (source) query.source = source;
        if (interest) query.interest = interest;
        if (assignedTo) query.assignedTo = assignedTo;
        if (q) {
            query.$or = [
                { firstName: { $regex: q, $options: 'i' } },
                { lastName: { $regex: q, $options: 'i' } },
                { phone: { $regex: q, $options: 'i' } },
                { email: { $regex: q, $options: 'i' } },
            ];
        }

        const [items, total] = await Promise.all([
            Lead.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('assignedTo', 'firstName lastName role specialization')
                .populate('convertedPatient', 'firstName lastName email role'),
            Lead.countDocuments(query),
        ]);

        return res.status(200).json({ page, limit, total, items });
    } catch (err) {
        return res.status(500).json({ msg: 'failed to fetch leads', error: err.message });
    }
});

router.get('/:id', canReadLeads, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ msg: 'invalid lead id' });
        }

        const lead = await Lead.findById(req.params.id)
            .populate('assignedTo', 'firstName lastName role specialization')
            .populate('convertedPatient', 'firstName lastName email role')
            .populate('createdByEmp', 'firstName lastName role')
            .populate('createdByAdmin', 'firstName lastName role')
            .populate('followUpHistory.createdByEmp', 'firstName lastName role')
            .populate('followUpHistory.createdByAdmin', 'firstName lastName role');

        if (!lead) {
            return res.status(404).json({ msg: 'lead not found' });
        }

        return res.status(200).json({ lead });
    } catch (err) {
        return res.status(500).json({ msg: 'failed to fetch lead', error: err.message });
    }
});

router.put('/:id', canWriteLeads, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ msg: 'invalid lead id' });
        }

        const parsed = updateLeadSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ msg: 'invalid lead update data', errors: parsed.error.flatten() });
        }

        const data = parsed.data;
        const assignedError = await validateAssignedEmployee(data.assignedTo);
        if (assignedError) {
            return res.status(400).json({ msg: assignedError });
        }

        const payload = { ...data };
        if (data.nextFollowUpDate) {
            payload.nextFollowUpDate = parseOptionalDate(data.nextFollowUpDate);
            if (payload.nextFollowUpDate === null) {
                return res.status(400).json({ msg: 'invalid nextFollowUpDate' });
            }
        }

        const lead = await Lead.findById(req.params.id);
        if (!lead) {
            return res.status(404).json({ msg: 'lead not found' });
        }

        Object.assign(lead, payload);
        lead.followUpHistory.push({
            note: data.notes || data.lostReason || 'lead updated',
            status: data.status,
            followUpDate: payload.nextFollowUpDate,
            createdByRole: req.actor.role,
            createdByEmp: req.actor.type === 'employee' ? req.actor.id : undefined,
            createdByAdmin: req.actor.type === 'admin' ? req.actor.id : undefined,
        });
        await lead.save();

        await lead.populate([
            { path: 'assignedTo', select: 'firstName lastName role specialization' },
            { path: 'convertedPatient', select: 'firstName lastName email role' },
        ]);

        return res.status(200).json({ msg: 'lead updated successfully', lead });
    } catch (err) {
        return res.status(500).json({ msg: 'failed to update lead', error: err.message });
    }
});

router.post('/:id/convert', canWriteLeads, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ msg: 'invalid lead id' });
        }

        const parsed = convertLeadSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({ msg: 'invalid conversion data', errors: parsed.error.flatten() });
        }

        const lead = await Lead.findById(req.params.id);
        if (!lead) {
            return res.status(404).json({ msg: 'lead not found' });
        }

        if (lead.status === 'converted' && lead.convertedPatient) {
            return res.status(409).json({ msg: 'lead is already converted', patientId: lead.convertedPatient });
        }

        const data = parsed.data;
        const username = data.username || makeUsername(lead);
        const email = data.email || lead.email || `${username}@walkin.local`;
        const existing = await User.findOne({ $or: [{ username }, { email }] }).select('_id username email');
        if (existing) {
            return res.status(409).json({ msg: 'patient username or email already exists' });
        }

        const temporaryPassword = data.password || crypto.randomBytes(6).toString('base64url');
        const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
        const patientRole = data.role || leadInterestToPatientRole(lead.interest);

        const patient = await User.create({
            username,
            email,
            password: hashedPassword,
            firstName: lead.firstName,
            lastName: lead.lastName || '',
            role: patientRole,
            HearingServices: data.HearingServices || (patientRole === 'speech' ? 'None' : 'a'),
            SpeechServices: data.SpeechServices || (patientRole === 'hearing' ? 'None' : 'a'),
        });

        const profile = await PatientProfile.create({
            user: patient._id,
            phone: lead.phone,
            leadSource: lead.source,
            primaryConcern: leadInterestToPatientRole(lead.interest),
            clinicalNotes: lead.notes,
            assignedTherapist: lead.assignedTo,
            nextFollowUpDate: lead.nextFollowUpDate,
            caseStatus: 'active',
        });

        lead.status = 'converted';
        lead.convertedPatient = patient._id;
        lead.convertedAt = new Date();
        lead.followUpHistory.push({
            note: 'lead converted to patient',
            status: 'converted',
            createdByRole: req.actor.role,
            createdByEmp: req.actor.type === 'employee' ? req.actor.id : undefined,
            createdByAdmin: req.actor.type === 'admin' ? req.actor.id : undefined,
        });
        await lead.save();

        const patientResponse = patient.toObject();
        delete patientResponse.password;

        return res.status(201).json({
            msg: 'lead converted successfully',
            lead,
            patient: patientResponse,
            profile,
            temporaryPassword: data.password ? undefined : temporaryPassword,
        });
    } catch (err) {
        return res.status(500).json({ msg: 'failed to convert lead', error: err.message });
    }
});

module.exports = router;
