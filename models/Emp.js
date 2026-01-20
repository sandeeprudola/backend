const mongoose = require('mongoose');
const { string } = require('zod');

const EmployeeSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        trim: true,
        maxLength: 50
    },
    password:{
        type: String,
        required: true,
        maxLength: 100

    },
    firstName: {
        type: String,
        required: true,
        trim: true,
        maxLength: 50
    },
    lastName: {
        type: String,
        trim: true,
        maxLength: 50
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    role: {
        type: String,
        enum: ['therapist', 'audiologist', 'receptionist'],
        required: true
    },
    specialization: {
        type: String,
        require:true,
        trim: true // e.g., "Speech Therapy", "Occupational Therapy"
    },
    joinedAt: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    }
});



module.exports=mongoose.model("Emp",EmployeeSchema)
