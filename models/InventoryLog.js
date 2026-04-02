const mongoose = require('mongoose');

const InventoryLogSchema = new mongoose.Schema(
    {
        item: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'InventoryItem',
            required: true,
        },
        type: {
            type: String,
            enum: ['in', 'out', 'adjustment'],
            default: 'in',
            required: true,
        },
        quantity: {
            type: Number,
            required: true,
            min: 1,
        },
        note: {
            type: String,
            trim: true,
            maxlength: 300,
        },
        loggedByEmp: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Emp',
        },
        loggedByAdmin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'admin',
        },
        loggedByRole: {
            type: String,
            enum: ['therapist', 'audiologist', 'receptionist', 'admin', 'super-admin'],
            required: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('InventoryLog', InventoryLogSchema);

