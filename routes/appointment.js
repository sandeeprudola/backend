const express=require('express')
const router = express.Router();
const Appointment=require('../models/Appointment')
const auth=require('../middlewares/authmiddleware')
const User=require('../models/User')
const Emp=require('../models/Emp')
const zod=require('zod')

const createAppointmentSchema = zod.object({
    staff: zod.string(),
    appointmentdate: zod.string(),
    appointmentType: zod.enum(['consultation','speech-therapy','hearing-test','followup','emergency']),
    notes: zod.string().optional()
});
const updateAppointmentSchema = zod.object({
    duration:zod.number().optional(),
    status:zod.enum(['scheduled','confirmed','in-progress','completed','canceled']),
    priority:zod.enum(['low','normal','high','emergency']),
    appointmentdate: zod.string(),
    notes: zod.string().optional(),
    appointmentType: zod.enum(['consultation','speech-therapy','hearing-test','followup','emergency']),
    paymentStatus: zod.enum(['pending','paid','partial','waived']).optional()
});

router.post("/user",auth(),async(req,res)=>{
    try{
        const parsed=createAppointmentSchema.safeParse(req.body);
        if(!parsed.success){
            return res.status(400).json({
                msg:"invalid data"
            })
        }

        const data=parsed.data;
        const staff=await Emp.findById(data.staff);
        if(!staff){
            return res.status(404).json({msg:"no staff exist"})
        }
        if(!staff.isActive){
            return res.status(400).json({msg:"no staff is not active right now"})
        }

        const appointment=new Appointment({
            patient:req.user.id,
            staff:data.staff,
            appointmentdate: new Date(data.appointmentdate),
            duration:data.duration??30,
            appointmentType:data.appointmentType,
            notes:data.notes,
        })

        await appointment.save()
        await appointment.populate('patient staff','firstName lastName email specialization role')
        res.status(201).json({
            msg:"appointment created successfully",
            appointment
        })
    }
    catch(err){
        return res.status(500).json({
            msg:"failed to create appointment"
        })
    }
    

})

router.get("/ps",auth(),async(req,res)=>{

    try{
        const employee = await Emp.findById(req.user.id)
        if(!employee){
            return res.status(403).json({msg:"no access"})
        }

        const {status}=req.query;
        const query= {staff:req.user.id}

        if(status) query.status=status;

        const items=await Appointment.find(query)
        .populate('patient', 'firstName lastName email role ')
        .populate('staff','firstName lastName specilization role ')
        .sort({appointmentdate:1})

        res.json({
            appointments:items
        })

    }
    catch(err){
        res.status(500).json({msg:"failed to fetch appointments"})
    }
})  

router.get("/update",auth(),async(req,res)=>{
    
})
module.exports=router;