const express=require('express')
const userRouter=require("./user")
const employeeRouter=require("./employee")
const adminRouter=require("./admin");
const appointment=require("./appointment")
const attendance=require("./attendance")

const router=express.Router();

router.use("/user",userRouter)
router.use("/admin",adminRouter)
router.use("/employee",employeeRouter)
router.use("/appointment",appointment)
router.use("/attendance",attendance)

module.exports=router;
