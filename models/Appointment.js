const mongoose = require('mongoose'); 
const User = require("./User");
const Emp = require("./Emp");

const AppointmentSchema = new mongoose.Schema({
    patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: true,
    },
    staff: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Emp',
        required: true,
    },
    appointmentdate: {
        type: Date,
        required: true,
    },
    duration: {
        type: Number,
        default: 30,  // default 30 minutes
        required: true,
    },
    status: {
        type: String,
        enum: ['scheduled', 'confirmed', 'in-progress', 'completed', 'canceled'],
        default: 'scheduled',
        required: true,
    },
    appointmentType: {
        type: String,
        enum: ['consultation', 'speech-therapy', 'hearing-test', 'followup', 'emergency'],
        required: true,
    },
    notes: {
        type: String,
        trim: true,
        maxlength: 300,
    },
    priority: {
        type: String,
        enum: ['low', 'normal', 'high', 'emergency'],
        default: 'normal',
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'partial', 'waived'],
        default: 'pending',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    }
});

// auto update updatedAt before save
AppointmentSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model("Appointment", AppointmentSchema);
