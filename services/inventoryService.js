const mongoose = require('mongoose');
const InventoryItem = require('../models/InventoryItem');
const InventoryLog = require('../models/InventoryLog');
const Emp = require('../models/Emp');
const Admin = require('../models/Admin');

function fullName(firstName, lastName) {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || 'Unknown';
}

/**
 * API-friendly log shape: who logged is `loggedBy: { name, role, type }` (no raw Emp/admin ids).
 */
function formatInventoryLogForClient(doc) {
    const o = doc && doc.toObject ? doc.toObject() : { ...doc };
    const result = { ...o };

    if (result.loggedByEmp && typeof result.loggedByEmp === 'object' && result.loggedByEmp.firstName !== undefined) {
        result.loggedBy = {
            type: 'employee',
            name: fullName(result.loggedByEmp.firstName, result.loggedByEmp.lastName),
            role: result.loggedByEmp.role,
        };
    }
    delete result.loggedByEmp;

    if (result.loggedByAdmin && typeof result.loggedByAdmin === 'object' && result.loggedByAdmin.firstName !== undefined) {
        result.loggedBy = {
            type: 'admin',
            name: fullName(result.loggedByAdmin.firstName, result.loggedByAdmin.lastName),
            role: result.loggedByAdmin.role,
        };
    }
    delete result.loggedByAdmin;

    // Single source of truth for role in API: populated staff/admin record (matches who is linked on the log)
    if (result.loggedBy && result.loggedBy.role) {
        result.loggedByRole = result.loggedBy.role;
    }

    return result;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toObjectId(actorId) {
    if (actorId == null || actorId === '') {
        return null;
    }
    const s = String(actorId);
    if (!mongoose.Types.ObjectId.isValid(s)) {
        return null;
    }
    return new mongoose.Types.ObjectId(s);
}

async function resolveInventoryItem({ itemId, sku }) {
    if (itemId && mongoose.Types.ObjectId.isValid(itemId)) {
        return InventoryItem.findById(itemId);
    }
    if (sku && typeof sku === 'string' && sku.trim()) {
        const trimmed = sku.trim();
        return InventoryItem.findOne({
            sku: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') },
        });
    }
    return null;
}

/**
 * Log stock in. Pass either `sku` (short code shown on dashboard) or `itemId`.
 * Prefer `sku` for employees who pick from a list by code/name.
 */
async function logInventoryIn({ itemId, sku, quantity, note, actorId, actorRole, actorType }) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('quantity must be greater than 0');
    }

    const hasId = itemId && mongoose.Types.ObjectId.isValid(itemId);
    const hasSku = sku && typeof sku === 'string' && sku.trim();
    if (!hasId && !hasSku) {
        throw new Error('provide sku or itemId');
    }

    const item = await resolveInventoryItem({ itemId, sku });
    if (!item) {
        throw new Error('inventory item not found');
    }

    // Always persist role + ref from DB using a normalized ObjectId (avoids wrong user / bad JWT subject)
    let roleForLog = actorRole;
    const actorOid = toObjectId(actorId);
    if (!actorOid) {
        throw new Error('invalid employee or admin id in token');
    }

    if (actorType === 'employee') {
        const emp = await Emp.findById(actorOid).select('role');
        if (!emp) {
            throw new Error('employee not found — use an employee token from /api/v1/employee/signin');
        }
        roleForLog = emp.role;
    } else if (actorType === 'admin') {
        const admin = await Admin.findById(actorOid).select('role');
        if (!admin) {
            throw new Error('admin not found');
        }
        roleForLog = admin.role;
    }

    const logPayload = {
        item: item._id,
        type: 'in',
        quantity,
        note: note || '',
        loggedByRole: roleForLog,
    };

    if (actorType === 'admin') {
        logPayload.loggedByAdmin = actorOid;
    } else {
        logPayload.loggedByEmp = actorOid;
    }

    const log = await InventoryLog.create(logPayload);

    item.currentQty += quantity;
    await item.save();

    const logWithPeople = await InventoryLog.findById(log._id)
        .populate('loggedByEmp', 'firstName lastName role')
        .populate('loggedByAdmin', 'firstName lastName role');

    return {
        item,
        log: formatInventoryLogForClient(logWithPeople),
    };
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

    const docs = await InventoryLog.find(query)
        .sort({ createdAt: -1 })
        .limit(safeLimit)
        .populate('item', 'name sku category unit')
        .populate('loggedByEmp', 'firstName lastName role')
        .populate('loggedByAdmin', 'firstName lastName role');

    return docs.map((doc) => formatInventoryLogForClient(doc));
}

module.exports = {
    logInventoryIn,
    resolveInventoryItem,
    createInventoryItem,
    listInventoryItems,
    listInventoryLogs,
    formatInventoryLogForClient,
};

