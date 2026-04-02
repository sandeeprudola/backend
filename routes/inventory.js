const express = require('express');
const router = express.Router();

const authmiddleware = require('../middlewares/authmiddleware');
const adminAuth = require('../middlewares/adminAuth');
const {
    logInventoryIn,
    createInventoryItem,
    listInventoryItems,
    listInventoryLogs,
} = require('../services/inventoryService');

// staff + admin can see inventory list
router.get('/items', async (req, res) => {
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

// employee logs stock in
router.post('/log-in', authmiddleware(['therapist', 'audiologist', 'receptionist']), async (req, res) => {
    try {
        const { itemId, quantity, note } = req.body || {};
        const result = await logInventoryIn({
            itemId,
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
        const { itemId, quantity, note } = req.body || {};
        const result = await logInventoryIn({
            itemId,
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
router.get('/logs', async (req, res) => {
    try {
        const { itemId, limit } = req.query;
        const logs = await listInventoryLogs({ itemId, limit });
        return res.status(200).json({ logs });
    } catch (err) {
        return res.status(500).json({ msg: 'failed to fetch inventory logs', error: err.message });
    }
});

module.exports = router;
