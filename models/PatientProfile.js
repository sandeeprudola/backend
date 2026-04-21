const mongoose = require('mongoose');

const PatientProfileSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        phone: {
            type: String,
            trim: true,
            maxlength: 20,
        },
        alternatePhone: {
            type: String,
            trim: true,
            maxlength: 20,
        },
        gender: {
            type: String,
            enum: ['male', 'female', 'other', 'prefer-not-to-say'],
        },
        dob: {
            type: Date,
        },
        guardianName: {
            type: String,
            trim: true,
            maxlength: 100,
        },
        relationWithPatient: {
            type: String,
            trim: true,
            maxlength: 80,
        },
        emergencyContactName: {
            type: String,
            trim: true,
            maxlength: 100,
        },
        emergencyContactPhone: {
            type: String,
            trim: true,
            maxlength: 20,
        },
        addressLine1: {
            type: String,
            trim: true,
            maxlength: 200,
        },
        addressLine2: {
            type: String,
            trim: true,
            maxlength: 200,
        },
        city: {
            type: String,
            trim: true,
            maxlength: 80,
        },
        state: {
            type: String,
            trim: true,
            maxlength: 80,
        },
        pincode: {
            type: String,
            trim: true,
            maxlength: 12,
        },
        leadSource: {
            type: String,
            trim: true,
            maxlength: 100,
        },
        referredBy: {
            type: String,
            trim: true,
            maxlength: 100,
        },
        primaryConcern: {
            type: String,
            enum: ['hearing', 'speech', 'both', 'other'],
        },
        diagnosis: {
            type: String,
            trim: true,
            maxlength: 500,
        },
        medicalHistory: {
            type: String,
            trim: true,
            maxlength: 1500,
        },
        clinicalNotes: {
            type: String,
            trim: true,
            maxlength: 2000,
        },
        assignedTherapist: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Emp',
        },
        assignedAudiologist: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Emp',
        },
        caseStatus: {
            type: String,
            enum: ['active', 'on-hold', 'completed', 'dropped'],
            default: 'active',
        },
        nextFollowUpDate: {
            type: Date,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('PatientProfile', PatientProfileSchema);
