const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const authmiddleware = require('../middlewares/authmiddleware');
const adminAuth = require('../middlewares/adminAuth');
const Admin = require('../models/Admin');
const Emp = require('../models/Emp');
const { JWT_SECRET } = require('../config');
const {
    logInventoryIn,
    createInventoryItem,
    listInventoryItems,
    listInventoryLogs,
} = require('../services/inventoryService');

async function inventoryReadAccess(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ msg: 'Authorization token missing' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const subjectId = decoded.userId ?? decoded.userid ?? decoded.id;

        if (decoded.role === 'admin' || decoded.role === 'super-admin') {
            const admin = await Admin.findById(subjectId).select('_id role firstName lastName');
            if (!admin) {
                return res.status(401).json({ msg: 'Admin not found' });
            }

            req.admin = admin;
            return next();
        }

        if (!['therapist', 'audiologist', 'receptionist'].includes(decoded.role)) {
            return res.status(403).json({ msg: 'Forbidden: insufficient role' });
        }

        const employee = await Emp.findById(subjectId).select('_id role firstName lastName isActive');
        if (!employee || !employee.isActive) {
            return res.status(403).json({ msg: 'Employee not found or inactive' });
        }

        req.user = {
            id: employee._id,
            role: employee.role,
        };
        return next();
    } catch (err) {
        return res.status(401).json({
            msg: 'Invalid or expired token',
            error: err.message,
        });
    }
}

// staff + admin can see inventory list
router.get('/items', inventoryReadAccess, async (req, res) => {
    try {
        const activeOnly = req.query.activeOnly === 'true';
        const items = await listInventoryItems({ activeOnly });
        return res.status(200).json({ items });
    } catch (err) {
        return res.status(500).json({ msg: 'failed to fetch inventory items', error: err.message });
    }
});

// admin creates master inventory item
router.post('/items', adminAuth, async (req, res) => {
    try {
        const { name, sku, category, unit, currentQty, isActive } = req.body || {};
        if (!name || !sku) {
            return res.status(400).json({ msg: 'name and sku are required' });
        }

        const item = await createInventoryItem({
            name,
            sku,
            category,
            unit,
            currentQty,
            isActive,
        });
        return res.status(201).json({ msg: 'inventory item created', item });
    } catch (err) {
        return res.status(500).json({ msg: 'failed to create inventory item', error: err.message });
    }
});

// employee logs stock in (use `sku` from dropdown — short code; optional `itemId`)
router.post('/log-in', authmiddleware(['therapist', 'audiologist', 'receptionist']), async (req, res) => {
    try {
        const { itemId, sku, quantity, note } = req.body || {};
        const result = await logInventoryIn({
            itemId,
            sku,
            quantity: Number(quantity),
            note,
            actorId: req.user.id,
            actorRole: req.user.role,
            actorType: 'employee',
        });

        return res.status(200).json({
            msg: 'inventory logged successfully',
            item: result.item,
            log: result.log,
        });
    } catch (err) {
        return res.status(400).json({ msg: err.message || 'failed to log inventory' });
    }
});

// admin logs stock in (same shared service)
router.post('/admin/log-in', adminAuth, async (req, res) => {
    try {
        const { itemId, sku, quantity, note } = req.body || {};
        const result = await logInventoryIn({
            itemId,
            sku,
            quantity: Number(quantity),
            note,
            actorId: req.admin._id,
            actorRole: req.admin.role,
            actorType: 'admin',
        });

        return res.status(200).json({
            msg: 'inventory logged successfully',
            item: result.item,
            log: result.log,
        });
    } catch (err) {
        return res.status(400).json({ msg: err.message || 'failed to log inventory' });
    }
});

// staff + admin can see inventory logs
router.get('/logs', inventoryReadAccess, async (req, res) => {
    try {
        const { itemId, limit } = req.query;
        const logs = await listInventoryLogs({ itemId, limit });
        return res.status(200).json({ logs });
    } catch (err) {
        return res.status(500).json({ msg: 'failed to fetch inventory logs', error: err.message });
    }
});

module.exports = router;
