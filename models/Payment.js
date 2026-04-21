const mongoose = require('mongoose');

const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank-transfer', 'cheque', 'other'];

const PaymentSchema = new mongoose.Schema(
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
            required: true,
            index: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 1,
        },
        method: {
            type: String,
            enum: PAYMENT_METHODS,
            required: true,
        },
        referenceNumber: {
            type: String,
            trim: true,
            maxlength: 120,
        },
        note: {
            type: String,
            trim: true,
            maxlength: 500,
        },
        paidAt: {
            type: Date,
            default: Date.now,
            required: true,
        },
        collectedByEmp: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Emp',
        },
        collectedByAdmin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'admin',
        },
        collectedByRole: {
            type: String,
            enum: ['receptionist', 'admin', 'super-admin'],
            required: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Payment', PaymentSchema);
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
