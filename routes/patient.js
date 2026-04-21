const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const zod = require('zod');

const Admin = require('../models/Admin');
const Appointment = require('../models/Appointment');
const Emp = require('../models/Emp');
const PatientProfile = require('../models/PatientProfile');
const Sale = require('../models/Sale');
const User = require('../models/User');
const { JWT_SECRET } = require('../config');

const router = express.Router();

const READ_ROLES = ['admin', 'super-admin', 'receptionist', 'therapist', 'audiologist'];
const WRITE_ROLES = ['admin', 'super-admin', 'receptionist'];

const profileSchema = zod.object({
    phone: zod.string().trim().max(20).optional(),
    alternatePhone: zod.string().trim().max(20).optional(),
    gender: zod.enum(['male', 'female', 'other', 'prefer-not-to-say']).optional(),
    dob: zod.string().datetime().optional(),
    guardianName: zod.string().trim().max(100).optional(),
    relationWithPatient: zod.string().trim().max(80).optional(),
    emergencyContactName: zod.string().trim().max(100).optional(),
    emergencyContactPhone: zod.string().trim().max(20).optional(),
    addressLine1: zod.string().trim().max(200).optional(),
    addressLine2: zod.string().trim().max(200).optional(),
    city: zod.string().trim().max(80).optional(),
    state: zod.string().trim().max(80).optional(),
    pincode: zod.string().trim().max(12).optional(),
    leadSource: zod.string().trim().max(100).optional(),
    referredBy: zod.string().trim().max(100).optional(),
    primaryConcern: zod.enum(['hearing', 'speech', 'both', 'other']).optional(),
    diagnosis: zod.string().trim().max(500).optional(),
    medicalHistory: zod.string().trim().max(1500).optional(),
    clinicalNotes: zod.string().trim().max(2000).optional(),
    assignedTherapist: zod.string().trim().min(1).optional(),
    assignedAudiologist: zod.string().trim().min(1).optional(),
    caseStatus: zod.enum(['active', 'on-hold', 'completed', 'dropped']).optional(),
    nextFollowUpDate: zod.string().datetime().optional(),
});

const createPatientSchema = zod.object({
    username: zod.string().trim().min(3).max(30),
    email: zod.string().trim().email(),
    password: zod.string().min(6).optional(),
    firstName: zod.string().trim().min(1).max(30),
    lastName: zod.string().trim().max(30).optional(),
    role: zod.enum(['hearing', 'speech', 'both']),
    HearingServices: zod.enum(['None', 'a', 'b', 'c']),
    SpeechServices: zod.enum(['None', 'a', 'b', 'c']),
    profile: profileSchema.optional(),
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

function buildProfilePayload(data) {
    const payload = { ...data };
    if (data.dob) {
        payload.dob = parseOptionalDate(data.dob);
    }
    if (data.nextFollowUpDate) {
        payload.nextFollowUpDate = parseOptionalDate(data.nextFollowUpDate);
    }
    return payload;
}

async function patientAccess(allowedRoles, req, res, next) {
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
            req.admin = admin;
            return next();
        }

        const employee = await Emp.findById(subjectId).select('_id role firstName lastName isActive');
        if (!employee || !employee.isActive) {
            return res.status(403).json({ msg: 'Employee not found or inactive' });
        }

        req.user = {
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

function canReadPatients(req, res, next) {
    return patientAccess(READ_ROLES, req, res, next);
}

function canWritePatients(req, res, next) {
    return patientAccess(WRITE_ROLES, req, res, next);
}

async function validateAssignedStaff({ assignedTherapist, assignedAudiologist }) {
    if (assignedTherapist) {
        if (!mongoose.Types.ObjectId.isValid(assignedTherapist)) {
            return 'assignedTherapist must be a valid employee id';
        }
        const therapist = await Emp.findOne({ _id: assignedTherapist, role: 'therapist', isActive: true }).select('_id');
        if (!therapist) {
            return 'assignedTherapist must be an active therapist';
        }
    }

    if (assignedAudiologist) {
        if (!mongoose.Types.ObjectId.isValid(assignedAudiologist)) {
            return 'assignedAudiologist must be a valid employee id';
        }
        const audiologist = await Emp.findOne({ _id: assignedAudiologist, role: 'audiologist', isActive: true }).select('_id');
        if (!audiologist) {
            return 'assignedAudiologist must be an active audiologist';
        }
    }

    return null;
}

router.post('/', canWritePatients, async (req, res) => {
    try {
        const parsed = createPatientSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                msg: 'invalid patient data',
                errors: parsed.error.flatten(),
            });
        }

        const data = parsed.data;
        const existingPatient = await User.findOne({
            $or: [{ username: data.username }, { email: data.email }],
        }).select('_id username email');

        if (existingPatient) {
            return res.status(409).json({ msg: 'patient username or email already exists' });
        }

        if (data.profile) {
            const staffError = await validateAssignedStaff(data.profile);
            if (staffError) {
                return res.status(400).json({ msg: staffError });
            }
        }

        const temporaryPassword = data.password || crypto.randomBytes(6).toString('base64url');
        const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

        const patient = await User.create({
            username: data.username,
            email: data.email,
            password: hashedPassword,
            firstName: data.firstName,
            lastName: data.lastName || '',
            role: data.role,
            HearingServices: data.HearingServices,
            SpeechServices: data.SpeechServices,
        });

        let profile = null;
        if (data.profile) {
            const payload = buildProfilePayload(data.profile);
            if (Object.values(payload).includes(null)) {
                return res.status(400).json({ msg: 'one or more provided dates are invalid' });
            }

            profile = await PatientProfile.create({
                user: patient._id,
                ...payload,
            });

            await profile.populate([
                { path: 'assignedTherapist', select: 'firstName lastName role specialization' },
                { path: 'assignedAudiologist', select: 'firstName lastName role specialization' },
            ]);
        }

        const patientResponse = patient.toObject();
        delete patientResponse.password;

        return res.status(201).json({
            msg: 'patient created successfully',
            patient: patientResponse,
            profile,
            temporaryPassword: data.password ? undefined : temporaryPassword,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to create patient',
            error: err.message,
        });
    }
});

router.get('/', canReadPatients, async (req, res) => {
    try {
        const { page, limit, skip } = parsePagination(req);
        const { q, role, caseStatus } = req.query;

        const query = {};
        if (role && ['hearing', 'speech', 'both'].includes(role)) {
            query.role = role;
        }

        if (q) {
            query.$or = [
                { firstName: { $regex: q, $options: 'i' } },
                { lastName: { $regex: q, $options: 'i' } },
                { email: { $regex: q, $options: 'i' } },
                { username: { $regex: q, $options: 'i' } },
            ];
        }

        const [users, total] = await Promise.all([
            User.find(query).sort({ firstName: 1, lastName: 1 }).skip(skip).limit(limit).select('-password'),
            User.countDocuments(query),
        ]);

        const userIds = users.map((user) => user._id);
        const profileQuery = { user: { $in: userIds } };
        if (caseStatus && ['active', 'on-hold', 'completed', 'dropped'].includes(caseStatus)) {
            profileQuery.caseStatus = caseStatus;
        }

        const profiles = await PatientProfile.find(profileQuery)
            .populate('assignedTherapist', 'firstName lastName role specialization')
            .populate('assignedAudiologist', 'firstName lastName role specialization');

        const profileMap = new Map(profiles.map((profile) => [String(profile.user), profile]));
        const items = users
            .map((user) => ({
                user,
                profile: profileMap.get(String(user._id)) || null,
            }))
            .filter((item) => !caseStatus || item.profile);

        return res.status(200).json({
            page,
            limit,
            total,
            items,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch patients',
            error: err.message,
        });
    }
});

router.get('/:id', canReadPatients, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ msg: 'invalid patient id' });
        }

        const patient = await User.findById(req.params.id).select('-password');
        if (!patient) {
            return res.status(404).json({ msg: 'patient not found' });
        }

        const [profile, appointments, sales] = await Promise.all([
            PatientProfile.findOne({ user: patient._id })
                .populate('assignedTherapist', 'firstName lastName role specialization')
                .populate('assignedAudiologist', 'firstName lastName role specialization'),
            Appointment.find({ patient: patient._id })
                .sort({ appointmentdate: -1 })
                .limit(20)
                .populate('staff', 'firstName lastName role specialization'),
            Sale.find({ patient: patient._id })
                .sort({ saleDate: -1, createdAt: -1 })
                .limit(20)
                .populate('soldByEmp', 'firstName lastName role'),
        ]);

        return res.status(200).json({
            patient,
            profile,
            appointments,
            sales,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch patient details',
            error: err.message,
        });
    }
});

router.put('/:id/profile', canWritePatients, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ msg: 'invalid patient id' });
        }

        const parsed = profileSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                msg: 'invalid patient profile data',
                errors: parsed.error.flatten(),
            });
        }

        const patient = await User.findById(req.params.id).select('_id');
        if (!patient) {
            return res.status(404).json({ msg: 'patient not found' });
        }

        const staffError = await validateAssignedStaff(parsed.data);
        if (staffError) {
            return res.status(400).json({ msg: staffError });
        }

        const payload = buildProfilePayload(parsed.data);
        if (Object.values(payload).includes(null)) {
            return res.status(400).json({ msg: 'one or more provided dates are invalid' });
        }

        const profile = await PatientProfile.findOneAndUpdate(
            { user: patient._id },
            { $set: payload, $setOnInsert: { user: patient._id } },
            { new: true, upsert: true, runValidators: true }
        )
            .populate('assignedTherapist', 'firstName lastName role specialization')
            .populate('assignedAudiologist', 'firstName lastName role specialization');

        return res.status(200).json({
            msg: 'patient profile saved successfully',
            profile,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to save patient profile',
            error: err.message,
        });
    }
});

module.exports = router;
