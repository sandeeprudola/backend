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

const availabilityQuerySchema = zod.object({
    staffId: zod.string().trim().min(1),
    date: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
    duration: zod.coerce.number().int().min(15).max(240).optional(),
});

const SLOT_INTERVAL_MINUTES = 30;
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 20;

router.get('/staff-list', async (req, res) => {
    try {
        const { role, q } = req.query;
        const query = { isActive: true };

        if (role && ['therapist', 'audiologist', 'receptionist'].includes(role)) {
            query.role = role;
        }

        if (q) {
            query.$or = [
                { firstName: { $regex: q, $options: 'i' } },
                { lastName: { $regex: q, $options: 'i' } },
                { specialization: { $regex: q, $options: 'i' } },
            ];
        }

        const staff = await Emp.find(query)
            .select('firstName lastName role specialization')
            .sort({ firstName: 1, lastName: 1 });

        return res.status(200).json({ staff });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch staff list',
            error: err.message,
        });
    }
});

function getAppointmentEndTime(appointmentDate, duration) {
    return new Date(appointmentDate.getTime() + duration * 60 * 1000);
}

function isWorkingHours(appointmentDate) {
    const hour = appointmentDate.getHours();
    return hour >= 9 && hour < 20;
}

function formatSlotTime(date) {
    return date.toISOString().slice(11, 16);
}

function buildDayBounds(dateString) {
    const dayStart = new Date(`${dateString}T00:00:00.000Z`);
    if (Number.isNaN(dayStart.getTime())) {
        return null;
    }

    const dayEnd = new Date(`${dateString}T23:59:59.999Z`);
    return { dayStart, dayEnd };
}

function buildSlotStart(dateString, hour, minute) {
    return new Date(`${dateString}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);
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

router.get('/availability', async (req, res) => {
    try {
        const parsed = availabilityQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({
                msg: 'invalid availability query',
                errors: parsed.error.flatten(),
            });
        }

        const { staffId, date, duration = 30 } = parsed.data;
        const staff = await Emp.findById(staffId).select('_id firstName lastName role specialization isActive');
        if (!staff || !staff.isActive) {
            return res.status(404).json({ msg: 'active staff member not found' });
        }

        const dayBounds = buildDayBounds(date);
        if (!dayBounds) {
            return res.status(400).json({ msg: 'invalid date' });
        }

        const appointments = await Appointment.find({
            staff: staff._id,
            status: { $nin: ['canceled'] },
            appointmentdate: {
                $gte: dayBounds.dayStart,
                $lte: dayBounds.dayEnd,
            },
        }).select('appointmentdate duration status');

        const bookedSlots = [];
        const availableSlots = [];

        for (let hour = WORK_START_HOUR; hour < WORK_END_HOUR; hour += 1) {
            for (let minute = 0; minute < 60; minute += SLOT_INTERVAL_MINUTES) {
                const slotStart = buildSlotStart(date, hour, minute);
                const slotEnd = getAppointmentEndTime(slotStart, duration);

                if (slotEnd.getUTCHours() > WORK_END_HOUR || (slotEnd.getUTCHours() === WORK_END_HOUR && slotEnd.getUTCMinutes() > 0)) {
                    continue;
                }

                const hasConflict = appointments.some((appointment) => {
                    const existingStart = new Date(appointment.appointmentdate);
                    const existingEnd = getAppointmentEndTime(existingStart, appointment.duration);
                    return slotStart < existingEnd && slotEnd > existingStart;
                });

                const slotLabel = formatSlotTime(slotStart);
                if (hasConflict) {
                    bookedSlots.push(slotLabel);
                } else {
                    availableSlots.push(slotLabel);
                }
            }
        }

        return res.status(200).json({
            staff: {
                _id: staff._id,
                firstName: staff.firstName,
                lastName: staff.lastName,
                role: staff.role,
                specialization: staff.specialization,
            },
            date,
            duration,
            workingHours: {
                start: '09:00',
                end: '20:00',
                slotIntervalMinutes: SLOT_INTERVAL_MINUTES,
            },
            bookedSlots,
            availableSlots,
        });
    } catch (err) {
        return res.status(500).json({
            msg: 'failed to fetch availability',
            error: err.message,
        });
    }
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
