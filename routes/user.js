const express=require('express');
const User=require('../models/User')
const Appointment=require("../models/Appointment")
const Sale = require('../models/Sale');
const {JWT_SECRET}=require('../config')
const router=express.Router();
const zod= require('zod')
const bcrypt=require('bcryptjs')
const jwt = require('jsonwebtoken');
const authmiddleware=require('../middlewares/authmiddleware')


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
        const user = await User.findById(req.user.id).select('_id username email firstName lastName role');
        if (!user) {
            return res.status(404).json({ msg: 'user not found' });
        }

        return res.status(200).json({ user });
    }
    catch(err){
        return res.status(500).json({
            msg:"failed to fetch user profile",
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



module.exports=router;
