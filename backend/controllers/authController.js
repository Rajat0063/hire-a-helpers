const User = require('../models/User');
const { getIO } = require('../socket');
const UserProfileHistory = require('../models/userProfileHistoryModel');
const UserProfile = require('../models/userProfileModel');
const Task = require('../models/taskModel');
const updateUserProfile = async (req, res) => {
    try {
        console.log('PATCH /api/auth/profile called');
        console.log('req.user:', req.user);
        console.log('req.body:', req.body);
        const userId = req.user._id;
        const { name, image, phoneNumber } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const updates = {};
        let changed = false;

        if (typeof name === 'string' && name.trim() && name.trim() !== user.name) {
            await UserProfileHistory.create({
                userId: user._id,
                field: 'name',
                oldValue: user.name || '',
                newValue: name.trim(),
                changedBy: user._id,
                changedAt: new Date(),
                note: `updated from '${user.name || ''}' to '${name.trim()}'`
            });
            updates.name = name.trim();
            changed = true;
        }
        if (typeof image === 'string' && image.trim() && image.trim() !== user.image) {
            await UserProfileHistory.create({
                userId: user._id,
                field: 'image',
                oldValue: user.image || '',
                newValue: image.trim(),
                changedBy: user._id,
                changedAt: new Date(),
                note: `updated from '${user.image || ''}' to '${image.trim()}'`
            });
            updates.image = image.trim();
            changed = true;
        }
        if (typeof phoneNumber === 'string' && phoneNumber !== user.phoneNumber) {
            await UserProfileHistory.create({
                userId: user._id,
                field: 'phoneNumber',
                oldValue: user.phoneNumber || '',
                newValue: phoneNumber,
                changedBy: user._id,
                changedAt: new Date(),
                note: `updated from '${user.phoneNumber || ''}' to '${phoneNumber}'`
            });
            updates.phoneNumber = phoneNumber;
            changed = true;
        }

        if (changed) {
            const updatedUser = await User.findOneAndUpdate(
                { _id: userId },
                { $set: updates },
                { new: true }
            );
            if (updatedUser) {
                Object.assign(user, updatedUser.toObject()); 
            }
        }
        
        if (req.body.email && req.body.email !== user.email) {
            return res.status(400).json({ message: 'Email cannot be changed.' });
        }

        await UserProfile.findOneAndUpdate(
            { userId: user._id },
            {
                userId: user._id,
                name: user.name,
                email: user.email,
                image: user.image,
                updatedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        await Task.updateMany(
            { $or: [ { postedByName: user.name }, { userId: user._id } ] },
            { $set: { userImageUrl: user.image, postedByName: user.name } }
        );

        try {
            const io = getIO();
            io.emit(`user-updated-${user._id}`, {
                _id: user._id,
                name: user.name,
                email: user.email,
                image: user.image,
                phoneNumber: user.phoneNumber,
            });
        } catch (socketErr) {
            console.error('Failed to emit socket event for profile update:', socketErr);
        }

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            image: user.image,
            phoneNumber: user.phoneNumber,
        });
    } catch (error) {
        console.error('Update profile error:', error);
        if (error && error.stack) {
            console.error('Stack:', error.stack);
        }
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/sendEmail');
const crypto = require('crypto');
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN,
    });
};

const registerUser = async (req, res) => {
    const { name, email, password, phoneNumber } = req.body;

    try {
        let user = await User.findOne({ email });

        if (user && !user.isVerified) {
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            user.otp = otp;
            user.otpExpires = Date.now() + 10 * 60 * 1000;
            user.password = password; 
            
            await user.save();

            const message = `Welcome back! Your new One-Time Password (OTP) for Hire-a-Helper is: ${otp}`;
            await sendEmail({ email: user.email, subject: 'Your New Verification Code', message });

            return res.status(200).json({ success: true, message: `A new OTP has been sent to ${user.email}.` });
        }

        if (user && user.isVerified) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        const userImage = `https://placehold.co/100x100/52525b/ffffff?text=${name.charAt(0).toUpperCase()}`;
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = Date.now() + 10 * 60 * 1000;
        const message = `Your One-Time Password (OTP) for Hire-a-Helper is: ${otp}\nThis code will expire in 10 minutes.`;

        await sendEmail({
            email,
            subject: 'Your Verification Code',
            message,
        });

        user = await User.create({
            name,
            email,
            password,
            phoneNumber,
            image: userImage,
            otp,
            otpExpires
        });

        res.status(201).json({ 
            success: true, 
            message: `An OTP has been sent to ${email}. Please verify to continue.` 
        });

    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ message: `Server Error: ${error.message}` });
    }
};

const verifyOtp = async (req, res) => {
    const { email, otp } = req.body;

    try {
        const user = await User.findOne({ 
            email, 
            otp,
            otpExpires: { $gt: Date.now() }
        }).select('+password');

        if (!user) {
            return res.status(400).json({ message: 'Invalid OTP or OTP has expired.' });
        }

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        res.status(200).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            image: user.image,
            token: generateToken(user._id),
        });

    } catch (error) {
        console.error("OTP Verification Error:", error);
        res.status(500).json({ message: `Server Error: ${error.message}` });
    }
};

const loginUser = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        if (!user.isVerified) {
            return res.status(401).json({ message: 'Account not verified. Please check your email for the OTP.' });
        }
        
        if (await user.matchPassword(password)) {
            res.json({
                _id: user._id,
                name: user.name,
                email: user.email,
                image: user.image,
                isAdmin: user.isAdmin,
                token: generateToken(user._id),
            });
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: `Server Error: ${error.message}` });
    }
};

const forgotPassword = async (req, res) => {
    const { email } = req.body;
    let user;

    try {
        user = await User.findOne({ email });

        if (!user) {
             return res.status(200).json({ message: 'If an account with that email exists, a reset link has been sent.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');

        user.passwordResetToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');
            
        user.passwordResetExpires = Date.now() + 10 * 60 * 1000;
        
        await user.save();

        const resetURL = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

        const message = `You requested a password reset. Click this link to reset your password:\n\n${resetURL}\n\nThis link will expire in 10 minutes. If you did not make this request, please ignore this email.`;
        
        await sendEmail({
            email: user.email,
            subject: 'Your Password Reset Link',
            message,
        });

        res.status(200).json({ message: 'If an account with that email exists, a reset link has been sent.' });

    } catch (error) {
        console.error("FORGOT PASSWORD ERROR:", error);

        if (user) {
            user.passwordResetToken = undefined;
            user.passwordResetExpires = undefined;
            await user.save();
        }
        
        res.status(500).json({ message: 'An error occurred while sending the email. Please try again.' });
    }
};

const resetPassword = async (req, res) => {
    try {
        const resetToken = req.params.token;
        const hashedToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');

        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpires: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired token.' });
        }

        user.password = req.body.password;
        
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;

        await user.save();

        res.status(200).json({ message: 'Your password has been reset successfully.' });

    } catch (error) {
        console.error("RESET PASSWORD ERROR:", error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
};

module.exports = { registerUser, verifyOtp, loginUser, forgotPassword, resetPassword, updateUserProfile };