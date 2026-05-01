const express=require('express')
const router=express.Router();
const zod= require('zod');
const bcrypt = require('bcryptjs');
const Emp = require('../models/Emp');
const Attendance = require('../models/Attendance');
const Appointment = require('../models/Appointment');
const InventoryItem = require('../models/InventoryItem');
const InventoryLog = require('../models/InventoryLog');
const Lead = require('../models/Lead');
const Sale = require('../models/Sale');
const ServiceTicket = require('../models/ServiceTicket');
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require('../config');
const authmiddleware = require('../middlewares/authmiddleware');

const EMPLOYEE_ROLES = ['therapist', 'audiologist', 'receptionist'];

const signupSchema=zod.object({
    username:zod.string(),
    password:zod.string(),
    firstName:zod.string(),
    lastName:zod.string(),
    email:zod.string().email(),
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
        $or: [{ username:req.body.username }, { email:req.body.email }]
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
    },JWT_SECRET, { expiresIn: '1d' })

    res.status(201).json({message:"Employee created successfully",token, employee: publicEmployee(Employee)})
    }
    catch(err){
        console.error(err);
        res.status(500).json({ msg:"Internal Server Error" });
    }



})

const signinSchema=zod.object({
    username:zod.string().optional(),
    email:zod.string().email().optional(),
    password:zod.string().min(1),
 }).refine((data) => data.username || data.email, {
    message: 'username or email is required',
 })

function publicEmployee(employee) {
    return {
        id: employee._id,
        username: employee.username,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        phone: employee.phone,
        role: employee.role,
        specialization: employee.specialization,
        joinedAt: employee.joinedAt,
        isActive: employee.isActive,
    };
}

function todayBounds() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

 router.post("/signin",async(req,res)=>{
    try{
        const body=req.body;
    const {success}=signinSchema.safeParse(body);
    if(!success){
        return res.status(411).json({
            msg:"wrong info / email already taken"
        })
    }
    const query = body.email
        ? { email: body.email.toLowerCase() }
        : { username: body.username };

    const Employee=await Emp.findOne(query)

    if(Employee){
        if (!Employee.isActive) {
            return res.status(403).json({
                msg:"employee account is inactive"
            })
        }
        const isPassvalid=await bcrypt.compare(body.password,Employee.password)
        if(!isPassvalid){
            return res.status(411).json({
                msg:"wrong credentials"
            })
        }
        const token= jwt.sign({
            userId: Employee._id,
            role: Employee.role
        },JWT_SECRET, { expiresIn: '1d' })

        res.status(200).json({
            msg:"signin success",
            token,
            role:Employee.role,
            employee: publicEmployee(Employee)
            })
        return;
        }
        return res.status(401).json({
            msg:"employee not found"
        })
    }
    catch(err){
        console.error(err);
        res.status(500).json({ msg:"Internal Server Error" });
    }
 })

router.get('/me', authmiddleware(EMPLOYEE_ROLES), async (req, res) => {
    try {
        const employee = await Emp.findById(req.user.id).select('-password');
        if (!employee || !employee.isActive) {
            return res.status(404).json({ msg: 'employee not found or inactive' });
        }

        return res.status(200).json({ employee: publicEmployee(employee) });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ msg:"Internal Server Error" });
    }
})

router.get('/dashboard', authmiddleware(EMPLOYEE_ROLES), async (req, res) => {
    try {
        const employeeId = req.user.id;
        const employee = await Emp.findById(employeeId).select('-password');
        if (!employee || !employee.isActive) {
            return res.status(404).json({ msg: 'employee not found or inactive' });
        }

        const { start, end } = todayBounds();
        const twoWeeksAgo = new Date(start);
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 13);

        const [
            todayAttendance,
            attendanceHistory,
            appointments,
            leads,
            inventoryItems,
            inventoryLogs,
            sales,
            serviceTickets,
            appointmentCounts,
            leadCounts,
            ticketCounts,
        ] = await Promise.all([
            Attendance.findOne({ employee: employeeId, date: start }),
            Attendance.find({
                employee: employeeId,
                date: { $gte: twoWeeksAgo, $lte: end },
            }).sort({ date: -1 }).limit(14),
            Appointment.find({ staff: employeeId })
                .populate('patient', 'firstName lastName email role')
                .populate('staff', 'firstName lastName specialization role')
                .sort({ appointmentdate: 1 })
                .limit(12),
            Lead.find({
                $or: [{ assignedTo: employeeId }, { createdByEmp: employeeId }],
            })
                .populate('assignedTo', 'firstName lastName role specialization')
                .populate('convertedPatient', 'firstName lastName email role')
                .sort({ createdAt: -1 })
                .limit(12),
            InventoryItem.find({ isActive: true }).sort({ name: 1 }).limit(100),
            InventoryLog.find({ loggedByEmp: employeeId })
                .populate('item', 'name sku category unit currentQty')
                .sort({ createdAt: -1 })
                .limit(12),
            Sale.find({ soldByEmp: employeeId })
                .populate('patient', 'firstName lastName email')
                .populate('soldByEmp', 'firstName lastName role')
                .sort({ saleDate: -1, createdAt: -1 })
                .limit(12),
            ServiceTicket.find({
                $or: [{ assignedTo: employeeId }, { createdByEmp: employeeId }],
            })
                .populate('patient', 'firstName lastName email')
                .populate('sale', 'brand model serialNumber finalAmount paymentMode')
                .populate('assignedTo', 'firstName lastName role specialization')
                .sort({ createdAt: -1 })
                .limit(12),
            Appointment.aggregate([
                { $match: { staff: employee._id } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            Lead.aggregate([
                { $match: { $or: [{ assignedTo: employee._id }, { createdByEmp: employee._id }] } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            ServiceTicket.aggregate([
                { $match: { $or: [{ assignedTo: employee._id }, { createdByEmp: employee._id }] } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
        ]);

        const todayAppointments = appointments.filter((appointment) => {
            const appointmentDate = new Date(appointment.appointmentdate);
            return appointmentDate >= start && appointmentDate <= end;
        });

        const salesTotal = sales.reduce((sum, sale) => sum + (sale.finalAmount || 0), 0);

        return res.status(200).json({
            employee: publicEmployee(employee),
            summary: {
                todayAppointments: todayAppointments.length,
                totalAppointments: appointmentCounts.reduce((sum, item) => sum + item.count, 0),
                openLeads: leadCounts
                    .filter((item) => ['new', 'contacted', 'follow-up'].includes(item._id))
                    .reduce((sum, item) => sum + item.count, 0),
                activeTickets: ticketCounts
                    .filter((item) => ['open', 'in-progress'].includes(item._id))
                    .reduce((sum, item) => sum + item.count, 0),
                inventoryItems: inventoryItems.length,
                salesTotal,
            },
            attendance: {
                today: todayAttendance,
                history: attendanceHistory,
            },
            appointments,
            leads,
            inventory: {
                items: inventoryItems,
                logs: inventoryLogs,
            },
            sales,
            serviceTickets,
            breakdowns: {
                appointmentsByStatus: appointmentCounts,
                leadsByStatus: leadCounts,
                ticketsByStatus: ticketCounts,
            },
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ msg:"failed to load employee dashboard", error: err.message });
    }
})
module.exports=router;
