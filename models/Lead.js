const mongoose = require('mongoose');

const LEAD_STATUSES = ['new', 'contacted', 'follow-up', 'converted', 'lost'];
const LEAD_INTERESTS = ['hearing', 'speech', 'both', 'other'];
const LEAD_SOURCES = ['walk-in', 'phone-call', 'website', 'referral', 'instagram', 'facebook', 'camp', 'other','hospital'];

const LeadSchema = new mongoose.Schema(
    {
        firstName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 50,
        },
        lastName: {
            type: String,
            trim: true,
            maxlength: 50,
        },
        phone: {
            type: String,
            required: true,
            trim: true,
            maxlength: 20,
            index: true,
        },
        email: {
            type: String,
            trim: true,
            lowercase: true,
            maxlength: 120,
        },
        interest: {
            type: String,
            enum: LEAD_INTERESTS,
            required: true,
        },
        source: {
            type: String,
            enum: LEAD_SOURCES,
            default: 'other',
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: LEAD_STATUSES,
            default: 'new',
            index: true,
        },
        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Emp',
        },
        nextFollowUpDate: {
            type: Date,
            index: true,
        },
        notes: {
            type: String,
            trim: true,
            maxlength: 1500,
        },
        lostReason: {
            type: String,
            trim: true,
            maxlength: 500,
        },
        convertedPatient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        convertedAt: {
            type: Date,
        },
        createdByEmp: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Emp',
        },
        createdByAdmin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'admin',
        },
        createdByRole: {
            type: String,
            enum: ['receptionist', 'admin', 'super-admin'],
            required: true,
        },
        followUpHistory: [
            {
                note: {
                    type: String,
                    trim: true,
                    maxlength: 500,
                },
                status: {
                    type: String,
                    enum: LEAD_STATUSES,
                },
                followUpDate: {
                    type: Date,
                },
                createdAt: {
                    type: Date,
                    default: Date.now,
                },
                createdByEmp: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Emp',
                },
                createdByAdmin: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'admin',
                },
                createdByRole: {
                    type: String,
                    enum: ['receptionist', 'admin', 'super-admin'],
                },
            },
        ],
    },
    { timestamps: true }
);

module.exports = mongoose.model('Lead', LeadSchema);
module.exports.LEAD_STATUSES = LEAD_STATUSES;
module.exports.LEAD_INTERESTS = LEAD_INTERESTS;
module.exports.LEAD_SOURCES = LEAD_SOURCES;
