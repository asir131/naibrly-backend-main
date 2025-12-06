const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const adminAuth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'No token, authorization denied' 
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const admin = await Admin.findById(decoded.userId);
        
        if (!admin) {
            return res.status(401).json({ 
                success: false, 
                message: 'Token is not valid' 
            });
        }

        if (!admin.isActive) {
            return res.status(401).json({ 
                success: false, 
                message: 'Admin account is deactivated' 
            });
        }

        req.user = admin;
        next();
    } catch (error) {
        res.status(401).json({ 
            success: false, 
            message: 'Token is not valid' 
        });
    }
};

// Make sure you're exporting correctly
module.exports = { adminAuth };