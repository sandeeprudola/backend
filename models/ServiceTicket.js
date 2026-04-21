const mongoose = require('mongoose');

const SERVICE_TYPES = ['repair', 'after-sale-service', 'annual-maintenance', 'fitting-followup', 'general-followup'];
const SERVICE_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const SERVICE_STATUSES = ['open', 'in-progress', 'resolved', 'cancelled'];

const ServiceTicketSchema = new mongoose.Schema(
    {
        patient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        sale: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Sale',
        },
        type: {
            type: String,
            enum: SERVICE_TYPES,
            required: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 150,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 1500,
        },
        priority: {
            type: String,
            enum: SERVICE_PRIORITIES,
            default: 'normal',
        },
        status: {
            type: String,
            enum: SERVICE_STATUSES,
            default: 'open',
            index: true,
        },
        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Emp',
        },
        dueDate: {
            type: Date,
        },
        completedAt: {
            type: Date,
        },
        serviceNotes: {
            type: String,
            trim: true,
            maxlength: 2000,
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
            enum: ['receptionist', 'audiologist', 'therapist', 'admin', 'super-admin'],
            required: true,
        },
        statusHistory: [
            {
                status: {
                    type: String,
                    enum: SERVICE_STATUSES,
                    required: true,
                },
                note: {
                    type: String,
                    trim: true,
                    maxlength: 500,
                },
                changedAt: {
                    type: Date,
                    default: Date.now,
                },
                changedByEmp: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Emp',
                },
                changedByAdmin: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'admin',
                },
                changedByRole: {
                    type: String,
                    enum: ['receptionist', 'audiologist', 'therapist', 'admin', 'super-admin'],
                    required: true,
                },
            },
        ],
    },
    { timestamps: true }
);

module.exports = mongoose.model('ServiceTicket', ServiceTicketSchema);
module.exports.SERVICE_TYPES = SERVICE_TYPES;
module.exports.SERVICE_PRIORITIES = SERVICE_PRIORITIES;
module.exports.SERVICE_STATUSES = SERVICE_STATUSES;
