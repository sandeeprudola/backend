const mongoose = require('mongoose');

const EMIPlanSchema = new mongoose.Schema(
    {
        downPayment: {
            type: Number,
            min: 0,
            default: 0,
        },
        installmentAmount: {
            type: Number,
            min: 0,
        },
        totalInstallments: {
            type: Number,
            min: 1,
        },
        nextDueDate: {
            type: Date,
        },
    },
    { _id: false }
);

const SaleSchema = new mongoose.Schema(
    {
        patient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        brand: {
            type: String,
            required: true,
            trim: true,
            maxlength: 80,
        },
        model: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        serialNumber: {
            type: String,
            trim: true,
            maxlength: 120,
            unique: true,
            sparse: true,
        },
        side: {
            type: String,
            enum: ['left', 'right', 'both'],
            required: true,
        },
        saleDate: {
            type: Date,
            required: true,
            default: Date.now,
        },
        saleAmount: {
            type: Number,
            required: true,
            min: 0,
        },
        discount: {
            type: Number,
            default: 0,
            min: 0,
        },
        tax: {
            type: Number,
            default: 0,
            min: 0,
        },
        finalAmount: {
            type: Number,
            required: true,
            min: 0,
        },
        paymentMode: {
            type: String,
            enum: ['full', 'emi'],
            required: true,
        },
        paidAmount: {
            type: Number,
            default: 0,
            min: 0,
        },
        dueAmount: {
            type: Number,
            required: true,
            min: 0,
        },
        warrantyExpiryDate: {
            type: Date,
        },
        amcExpiryDate: {
            type: Date,
        },
        fittingDate: {
            type: Date,
        },
        notes: {
            type: String,
            trim: true,
            maxlength: 1000,
        },
        emiPlan: EMIPlanSchema,
        soldByEmp: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Emp',
            required: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Sale', SaleSchema);
