const express=require('express');
const User=require('../models/User')
const Appointment=require("../models/Appointment")
const Sale = require('../models/Sale');
const PatientProfile = require('../models/PatientProfile');
const Emp = require('../models/Emp');
const Payment = require('../models/Payment');
const {JWT_SECRET}=require('../config')
const router=express.Router();
const zod= require('zod')
const bcrypt=require('bcryptjs')
const jwt = require('jsonwebtoken');
const authmiddleware=require('../middlewares/authmiddleware')

const patientProfileSchema = zod.object({
    phone: zod.string().trim().max(20).optional(),
    alternatePhone: zod.string().trim().max(20).optional(),
    gender: zod.enum(['male', 'female', 'other', 'prefer-not-to-say']).optional(),
    dob: zod.string().datetime().optional(),
    guardianName: zod.string().trim().max(100).optional(),
    relationWithPatient: zod.string().trim().max(80).optional(),
    emergencyContactName: zod.string().trim().max(100).optional(),
    emergencyContactPhone: zod.string().trim().max(20).optional(),
    addressLine1: zod.string().trim().max(200).optional(),
    addressLine2: zod.string().trim().max(200).optional(),
    city: zod.string().trim().max(80).optional(),
    state: zod.string().trim().max(80).optional(),
    pincode: zod.string().trim().max(12).optional(),
    leadSource: zod.string().trim().max(100).optional(),
    referredBy: zod.string().trim().max(100).optional(),
    primaryConcern: zod.enum(['hearing', 'speech', 'both', 'other']).optional(),
    diagnosis: zod.string().trim().max(500).optional(),
    medicalHistory: zod.string().trim().max(1500).optional(),
    clinicalNotes: zod.string().trim().max(2000).optional(),
    assignedTherapist: zod.string().trim().min(1).optional(),
    assignedAudiologist: zod.string().trim().min(1).optional(),
    caseStatus: zod.enum(['active', 'on-hold', 'completed', 'dropped']).optional(),
    nextFollowUpDate: zod.string().datetime().optional(),
});

function parseProfileDate(value) {
    if (!value) {
        return undefined;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

async function validateAssignedStaff({ assignedTherapist, assignedAudiologist }) {
    if (assignedTherapist) {
        const therapist = await Emp.findOne({ _id: assignedTherapist, role: 'therapist', isActive: true }).select('_id');
        if (!therapist) {
            return 'assignedTherapist must be an active therapist';
        }
    }

    if (assignedAudiologist) {
        const audiologist = await Emp.findOne({ _id: assignedAudiologist, role: 'audiologist', isActive: true }).select('_id');
        if (!audiologist) {
            return 'assignedAudiologist must be an active audiologist';
        }
    }

    return null;
}

function buildProfilePayload(data) {
    const payload = { ...data };
    if (data.dob) {
        payload.dob = parseProfileDate(data.dob);
    }
    if (data.nextFollowUpDate) {
        payload.nextFollowUpDate = parseProfileDate(data.nextFollowUpDate);
    }
    return payload;
}


const signupSchema=zod.object({
    username:zod.string(),
    email:zod.string(),
    password:zod.string(),
    firstName:zod.string(),
    lastName:zod.string(),
    role: zod.enum(["hearing","speech","both"]),
    HearingServices:zod.enum(['None','a','b','c']),
    SpeechServices:zod.enum(['None','a','b','c']),
})

router.post("/signup",async(req,res)=>{
    const body=req.body;
    const {success}=signupSchema.safeParse(body);
    if(!success){
        return res.status(411).json({message: "email taken /wrong credentials"})
    }
    const existinguser=await User.findOne({
        username:req.body.username,
        email: body.email 
    })
    if(existinguser){
        return res.status(411).json("email/username already taken or incorrect credentials")
    }
    
    const { username,email,password, firstName, lastName, role,HearingServices,SpeechServices } = body;
    const hashedpassword= await bcrypt.hash(password,10);
    const user=new User({
        username,
        email,
        password: hashedpassword,
        firstName,
        lastName,
        role,
        HearingServices,
        SpeechServices

    })

    await user.save();
    const token=jwt.sign({
        userId:user._id,
        role:user.role,
        HearingServices:user.HearingServices,
        SpeechServices:user.SpeechServices,
    },JWT_SECRET)

    res.status(200).json({message:"user created successfully",token})

})


 const signinSchema=zod.object({
    username:zod.string(),
    email:zod.string(),
    password:zod.string(),
 })

router.post("/signin",async(req,res)=>{
    const body=req.body;
    const {success}=signinSchema.safeParse(body);
    if(!success){
        return res.status(411).json({msg: "wrong info / email already taken"})
    }
    const user=await User.findOne({
        username:req.body.username,
        email:req.body.email
    })

    if(user){
        const isPassvalid=await bcrypt.compare(body.password,user.password);
        if(!isPassvalid){
            res.status(411).json({msg:"wrong credentials"});
        }
        const token=jwt.sign({
            userId:user._id,
        },JWT_SECRET);
        
        res.status(200).json({
            msg:"signin success",
            token,
            role:user.role
        })
        return;
    }

})

  const update=zod.object({
    username:zod.string(),
    firstName:zod.string(),
    lastName:zod.string()
  })
router.put("/update",authmiddleware(),async(req,res)=>{
   try{
    const {success}=update.safeParse(req.body);
    if(!success){
        return res.status(401).json({msg:"updation failed"})
    }
    await User.updateOne(
        {_id:req.user_id},
        {$set:req.body}
    )
    res.json({
        msg:"user updated"
    })
   }
   catch(err){
     res.status(400).json({msg:"error while auth"})
   }

})

router.get('/me', authmiddleware(), async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('_id username email firstName lastName role HearingServices SpeechServices');
        if (!user) {
            return res.status(404).json({ msg: 'user not found' });
        }

        const profile = await PatientProfile.findOne({ user: user._id })
            .populate('assignedTherapist', 'firstName lastName role specialization')
            .populate('assignedAudiologist', 'firstName lastName role specialization');

        return res.status(200).json({ user, profile });
    }
    catch(err){
        return res.status(500).json({
            msg:"failed to fetch user profile",
            error: err.message
        })
    }
})

router.get('/profile', authmiddleware(), async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('_id username email firstName lastName role HearingServices SpeechServices');
        if (!user) {
            return res.status(404).json({ msg: 'user not found' });
        }

        const profile = await PatientProfile.findOne({ user: user._id })
            .populate('assignedTherapist', 'firstName lastName role specialization')
            .populate('assignedAudiologist', 'firstName lastName role specialization');

        return res.status(200).json({ user, profile });
    }
    catch(err){
        return res.status(500).json({
            msg:"failed to fetch patient profile",
            error: err.message
        })
    }
})

router.put('/profile', authmiddleware(), async (req, res) => {
    try {
        const parsed = patientProfileSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                msg: 'invalid patient profile data',
                errors: parsed.error.flatten(),
            });
        }

        const user = await User.findById(req.user.id).select('_id');
        if (!user) {
            return res.status(404).json({ msg: 'user not found' });
        }

        const staffError = await validateAssignedStaff(parsed.data);
        if (staffError) {
            return res.status(400).json({ msg: staffError });
        }

        const payload = buildProfilePayload(parsed.data);
        if (Object.values(payload).includes(null)) {
            return res.status(400).json({ msg: 'one or more provided dates are invalid' });
        }

        const profile = await PatientProfile.findOneAndUpdate(
            { user: user._id },
            { $set: payload, $setOnInsert: { user: user._id } },
            { new: true, upsert: true, runValidators: true }
        )
            .populate('assignedTherapist', 'firstName lastName role specialization')
            .populate('assignedAudiologist', 'firstName lastName role specialization');

        return res.status(200).json({
            msg: 'patient profile saved successfully',
            profile,
        });
    }
    catch(err){
        return res.status(500).json({
            msg:"failed to save patient profile",
            error: err.message
        })
    }
})

router.get("/dashboard",authmiddleware(),async(req,res)=>{
    try{
        const user = await User.findById(req.user.id)
  .select("firstName lastName email role");
        
        const nextAppointment=await Appointment.findOne({
            patient:req.user.id,
            appointmentdate: {$gte: new Date() }
        })
        .sort({appointmentdate:1})
        .populate("staff","firstName lastName specialization")

        const totalAppointments=await Appointment.countDocuments({
            patient:req.user.id
        })

        res.json({
            user:{
              firstName:user.firstName,
              lastName:user.lastName,
              email:user.email,
              role:user.role
            },
            nextAppointment,
            totalAppointments
          })
    }
    catch(err){
        res.status(500).json({
            msg:"internal server error"
        })
    }
})

router.get('/appointments', authmiddleware(), async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('_id');
        if (!user) {
            return res.status(404).json({ msg: 'user not found' });
        }

        const query = { patient: user._id };
        if (req.query.status) {
            query.status = req.query.status;
        }

        const appointments = await Appointment.find(query)
            .sort({ appointmentdate: 1 })
            .populate('staff', 'firstName lastName email role specialization');

        return res.status(200).json({ appointments });
    }
    catch(err){
        return res.status(500).json({
            msg:"failed to fetch user appointments",
            error: err.message
        })
    }
})

router.get('/sales', authmiddleware(), async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('_id firstName lastName email');
        if (!user) {
            return res.status(404).json({ msg: 'user not found' });
        }

        const sales = await Sale.find({ patient: user._id })
            .sort({ saleDate: -1, createdAt: -1 })
            .populate('soldByEmp', 'firstName lastName role');

        return res.status(200).json({
            user,
            sales,
        });
    }
    catch(err){
        return res.status(500).json({
            msg:"failed to fetch user sales",
            error: err.message
        })
    }
})

router.get('/payments', authmiddleware(), async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('_id firstName lastName email');
        if (!user) {
            return res.status(404).json({ msg: 'user not found' });
        }

        const payments = await Payment.find({ patient: user._id })
            .sort({ paidAt: -1, createdAt: -1 })
            .populate('sale', 'brand model serialNumber finalAmount paidAmount dueAmount paymentMode')
            .populate('collectedByEmp', 'firstName lastName role')
            .populate('collectedByAdmin', 'firstName lastName role');

        return res.status(200).json({
            user,
            payments,
        });
    }
    catch(err){
        return res.status(500).json({
            msg:"failed to fetch user payments",
            error: err.message
        })
    }
})



module.exports=router;
