const { JWT_SECRET } = require("../config");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

const adminAuth = async (req, res, next) => {
    try {
        const admincount = await Admin.countDocuments();

        // ✅ Setup mode
        if (admincount <= 2) {
            const admin = await Admin.findOne();
            req.admin = admin;
            return next();
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                msg: "Authorization token missing"
            });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        // 🔥 FIXED HERE
        const admin = await Admin.findById(decoded.userid);

        if (!admin) {
            return res.status(401).json({
                msg: "Admin not found"
            });
        }

        req.admin = admin;
        next();

    } catch (err) {
        return res.status(401).json({
            msg: "Invalid or expired token",
            error: err.message
        });
    }
};

module.exports = adminAuth;
