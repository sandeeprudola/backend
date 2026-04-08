const mongoose = require('mongoose');

const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'in-progress', 'completed', 'canceled'];
const APPOINTMENT_TYPES = ['consultation', 'speech-therapy', 'hearing-test', 'followup', 'emergency'];
const APPOINTMENT_PRIORITIES = ['low', 'normal', 'high', 'emergency'];
const PAYMENT_STATUSES = ['pending', 'paid', 'partial', 'waived'];

const AppointmentSchema = new mongoose.Schema(
    {
        patient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        staff: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Emp',
            required: true,
            index: true,
        },
        appointmentdate: {
            type: Date,
            required: true,
            validate: {
                validator(value) {
                    return value instanceof Date && !Number.isNaN(value.getTime());
                },
                message: 'appointmentdate must be a valid date',
            },
        },
        duration: {
            type: Number,
            default: 30,
            required: true,
            min: 15,
            max: 240,
        },
        status: {
            type: String,
            enum: APPOINTMENT_STATUSES,
            default: 'scheduled',
            required: true,
        },
        appointmentType: {
            type: String,
            enum: APPOINTMENT_TYPES,
            required: true,
        },
        notes: {
            type: String,
            trim: true,
            maxlength: 300,
        },
        priority: {
            type: String,
            enum: APPOINTMENT_PRIORITIES,
            default: 'normal',
        },
        paymentStatus: {
            type: String,
            enum: PAYMENT_STATUSES,
            default: 'pending',
        },
    },
    { timestamps: true }
);

AppointmentSchema.index({ staff: 1, appointmentdate: 1 });
AppointmentSchema.index({ patient: 1, appointmentdate: 1 });

module.exports = mongoose.model('Appointment', AppointmentSchema);
module.exports.APPOINTMENT_STATUSES = APPOINTMENT_STATUSES;
module.exports.APPOINTMENT_TYPES = APPOINTMENT_TYPES;
module.exports.APPOINTMENT_PRIORITIES = APPOINTMENT_PRIORITIES;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
