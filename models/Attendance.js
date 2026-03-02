const mongoose = require('mongoose');
const Emp = require('./Emp');
const Admin = require('./Admin');

const AttendanceSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Emp',
        required: true,
    },
    date: {
        type: Date,
        required: true,
    },
    checkInTime: {
        type: Date,
    },
    checkOutTime: {
        type: Date,
    },
    status: {
        type: String,
        enum: ['present', 'absent'],
        default: 'present',
        required: true,
    },
    // when an admin overrides or corrects attendance
    isOverriddenByAdmin: {
        type: Boolean,
        default: false,
    },
    overriddenBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'admin',
    },
    overrideReason: {
        type: String,
        trim: true,
        maxlength: 300,
    },
    // keep a simple history for corrections
    correctionNotes: [{
        note: {
            type: String,
            trim: true,
            maxlength: 300,
        },
        correctedAt: {
            type: Date,
            default: Date.now,
        },
        correctedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'admin',
        }
    }],
}, {
    timestamps: true,
});

// enforce one attendance record per employee per day
AttendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

// normalize date to start-of-day so uniqueness works reliably
AttendanceSchema.pre('save', function (next) {
    if (this.date) {
        const d = new Date(this.date);
        d.setHours(0, 0, 0, 0);
        this.date = d;
    }
    next();
});

module.exports = mongoose.model('Attendance', AttendanceSchema);

