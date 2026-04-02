const mongoose = require('mongoose');

const InventoryItemSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },
        sku: {
            type: String,
            required: true,
            trim: true,
            unique: true,
            maxlength: 50,
        },
        category: {
            type: String,
            enum: ['hearing-aid', 'battery', 'accessory', 'other'],
            default: 'other',
        },
        unit: {
            type: String,
            default: 'pcs',
            trim: true,
            maxlength: 20,
        },
        currentQty: {
            type: Number,
            default: 0,
            min: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('InventoryItem', InventoryItemSchema);

