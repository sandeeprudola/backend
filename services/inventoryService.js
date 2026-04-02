const mongoose = require('mongoose');
const InventoryItem = require('../models/InventoryItem');
const InventoryLog = require('../models/InventoryLog');

async function logInventoryIn({ itemId, quantity, note, actorId, actorRole, actorType }) {
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
        throw new Error('invalid itemId');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('quantity must be greater than 0');
    }

    const item = await InventoryItem.findById(itemId);
    if (!item) {
        throw new Error('inventory item not found');
    }

    const logPayload = {
        item: item._id,
        type: 'in',
        quantity,
        note: note || '',
        loggedByRole: actorRole,
    };

    if (actorType === 'admin') {
        logPayload.loggedByAdmin = actorId;
    } else {
        logPayload.loggedByEmp = actorId;
    }

    const log = await InventoryLog.create(logPayload);

    item.currentQty += quantity;
    await item.save();

    return { item, log };
}

async function createInventoryItem(payload) {
    const item = await InventoryItem.create(payload);
    return item;
}

async function listInventoryItems({ activeOnly }) {
    const query = {};
    if (activeOnly === true) {
        query.isActive = true;
    }
    return InventoryItem.find(query).sort({ name: 1 });
}

async function listInventoryLogs({ itemId, limit }) {
    const query = {};
    if (itemId && mongoose.Types.ObjectId.isValid(itemId)) {
        query.item = itemId;
    }

    const safeLimit = Math.min(Math.max(parseInt(limit || '50', 10), 1), 200);

    return InventoryLog.find(query)
        .sort({ createdAt: -1 })
        .limit(safeLimit)
        .populate('item', 'name sku category unit')
        .populate('loggedByEmp', 'firstName lastName username role')
        .populate('loggedByAdmin', 'firstName lastName username role');
}

module.exports = {
    logInventoryIn,
    createInventoryItem,
    listInventoryItems,
    listInventoryLogs,
};

