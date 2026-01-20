const express=require('express')
const router=express.Router();
const zod= require('zod');
const bcrypt = require('bcryptjs');
const Emp = require('../models/Emp');
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require('../config');

const signupSchema=zod.object({
    username:zod.string(),
    password:zod.string(),
    firstName:zod.string(),
    lastName:zod.string(),
    email:zod.string(),
    phone:zod.string(),
    role:zod.string(),
    specialization:zod.string(),
    joinedAt:zod.string().optional(),
    isActive:zod.boolean().optional(),

})

router.post("/signup",async(req,res)=>{
    try{
        const body=req.body;
    const {success}=signupSchema.safeParse(body);
    if(!success){
        return res.status(411).json({
            msg:"error in credentials"
        })
    }
    const existinguser=await Emp.findOne({
        username:req.body.username,
        email:req.body.email
    })
    if(existinguser){
        return res.status(411).json({
            msg:"email/username already taken"
        })
    }
    const {username,password,firstName,lastName,email,phone,role,specialization,joinedAt,isActive}=body
    const hashedpassword=await bcrypt.hash(password,10);
    const Employee=new Emp({
        username,
        password: hashedpassword,
        firstName,
        lastName,
        email,
        phone,
        role,
        specialization,
        joinedAt: joinedAt || new Date(),
        isActive: isActive !== undefined ? isActive : true
    })

    await Employee.save();
    const token=jwt.sign({
        userId: Employee._id,
        role: Employee.role
    },JWT_SECRET)

    res.status(200).json({message:"Employee created successfully",token})
    }
    catch(err){
        console.error(err);
        res.status(500).json({ msg:"Internal Server Error" });
    }



})

const signinSchema=zod.object({
    username:zod.string(),
    email:zod.string(),
    password:zod.string(),
 })

 router.post("/signin",async(req,res)=>{
    try{
        const body=req.body;
    const {success}=signinSchema.safeParse(body);
    if(!success){
        return res.status(411).json({
            msg:"wrong info / email already taken"
        })
    }
    const Employee=await Emp.findOne({
        username:req.body.username,
        email:req.body.email
    })

    if(Employee){
        const isPassvalid=await bcrypt.compare(body.password,Employee.password)
        if(!isPassvalid){
            return res.status(411).json({
                msg:"wrong credentials"
            })
        }
        const token= jwt.sign({
            userId: Employee._id,
            role: Employee.role
        },JWT_SECRET)

        res.status(200).json({
            msg:"signin success",
            token,
            role:Employee.role
            })
        }
    }
    catch(err){
        console.error(err);
        res.status(500).json({ msg:"Internal Server Error" });
    }
 })
module.exports=router;