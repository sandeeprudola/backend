const express=require('express');
const User=require('../models/User')
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
    role:zod.string()
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
    
    const { username,email,password, firstName, lastName, role } = body;
    const hashedpassword= await bcrypt.hash(password,10);
    const user=new User({
        username,
        email,
        password: hashedpassword,
        firstName,
        lastName,
        role
    })

    await user.save();
    const token=jwt.sign({
        userId:user._id,
        role:user.role
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
router.put("/update",authmiddleware,async(req,res)=>{
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



module.exports=router;