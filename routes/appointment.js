const express=require('express')
const router = express.Router();
const Appointment=require('../models/Appointment')
const auth=require('../middlewares/authmiddleware')
const User=require('../models/User')
const Emp=require('../models/Emp')
const zod=require('zod')

const createAppointmentSchema = zod.object({
    staff: zod.string().trim().min(1),
    appointmentdate: zod.string().datetime(),
    duration: zod.number().int().min(15).max(240).optional(),
    appointmentType: zod.enum(['consultation','speech-therapy','hearing-test','followup','emergency']),
    notes: zod.string().trim().max(300).optional(),
    priority: zod.enum(['low','normal','high','emergency']).optional()
});
const updateAppointmentSchema = zod.object({
    duration:zod.number().int().min(15).max(240).optional(),
    status:zod.enum(['scheduled','confirmed','in-progress','completed','canceled']).optional(),
    priority:zod.enum(['low','normal','high','emergency']).optional(),
    appointmentdate: zod.string().datetime().optional(),
    notes: zod.string().trim().max(300).optional(),
    appointmentType: zod.enum(['consultation','speech-therapy','hearing-test','followup','emergency']).optional(),
    paymentStatus: zod.enum(['pending','paid','partial','waived']).optional()
});

function getAppointmentEndTime(appointmentDate, duration) {
    return new Date(appointmentDate.getTime() + duration * 60 * 1000);
}

function isWorkingHours(appointmentDate) {
    const hour = appointmentDate.getHours();
    return hour >= 9 && hour < 20;
}

async function hasConflictingAppointment({ patientId, staffId, appointmentDate, duration }) {
    const proposedEnd = getAppointmentEndTime(appointmentDate, duration);
    const candidates = await Appointment.find({
        $or: [
            { patient: patientId },
            { staff: staffId },
        ],
        status: { $nin: ['canceled'] },
        appointmentdate: {
            $lt: proposedEnd,
            $gte: new Date(appointmentDate.getTime() - 4 * 60 * 60 * 1000),
        },
    }).select('patient staff appointmentdate duration');

    return candidates.some((existing) => {
        const existingStart = new Date(existing.appointmentdate);
        const existingEnd = getAppointmentEndTime(existingStart, existing.duration);
        return appointmentDate < existingEnd && proposedEnd > existingStart;
    });
}

router.post("/user",auth(),async(req,res)=>{
    try{
        const parsed=createAppointmentSchema.safeParse(req.body);
        if(!parsed.success){
            return res.status(400).json({
                msg:"invalid data"
            })
        }

        const data=parsed.data;
        const patient = await User.findById(req.user.id).select('_id');
        if (!patient) {
            return res.status(403).json({ msg: "only patients can create appointments" });
        }

        const staff=await Emp.findById(data.staff);
        if(!staff){
            return res.status(404).json({msg:"no staff exist"})
        }
        if(!staff.isActive){
            return res.status(400).json({msg:"no staff is not active right now"})
        }

        const appointmentDate = new Date(data.appointmentdate);
        if (Number.isNaN(appointmentDate.getTime())) {
            return res.status(400).json({ msg: "invalid appointment date" });
        }
        if (appointmentDate <= new Date()) {
            return res.status(400).json({ msg: "appointment date must be in the future" });
        }
        if (!isWorkingHours(appointmentDate)) {
            return res.status(400).json({ msg: "appointments can only be booked between 09:00 and 20:00" });
        }

        const duration = data.duration ?? 30;
        const hasConflict = await hasConflictingAppointment({
            patientId: patient._id,
            staffId: staff._id,
            appointmentDate,
            duration,
        });
        if (hasConflict) {
            return res.status(409).json({
                msg: "appointment slot is not available for the patient or staff",
            });
        }

        const appointment=new Appointment({
            patient:patient._id,
            staff:data.staff,
            appointmentdate: appointmentDate,
            duration,
            appointmentType:data.appointmentType,
            notes:data.notes,
            priority:data.priority,
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

router.get("/list",auth(['therapist', 'audiologist', 'receptionist']),async(req,res)=>{

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
        .populate('staff','firstName lastName specialization role ')
        .sort({appointmentdate:1})

        res.json({
            appointments:items
        })

    }
    catch(err){
        res.status(500).json({msg:"failed to fetch appointments"})
    }
})  
module.exports=router;
