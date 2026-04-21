const mongoose = require('mongoose');

const EMI_INSTALLMENT_STATUSES = ['pending', 'paid', 'overdue', 'cancelled'];

const EmiInstallmentSchema = new mongoose.Schema(
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
        installmentNumber: {
            type: Number,
            required: true,
            min: 1,
        },
        amount: {
            type: Number,
            required: true,
            min: 1,
        },
        dueDate: {
            type: Date,
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: EMI_INSTALLMENT_STATUSES,
            default: 'pending',
            index: true,
        },
        paidAt: {
            type: Date,
        },
        payment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Payment',
        },
        note: {
            type: String,
            trim: true,
            maxlength: 500,
        },
    },
    { timestamps: true }
);

EmiInstallmentSchema.index({ sale: 1, installmentNumber: 1 }, { unique: true });

module.exports = mongoose.model('EmiInstallment', EmiInstallmentSchema);
module.exports.EMI_INSTALLMENT_STATUSES = EMI_INSTALLMENT_STATUSES;
