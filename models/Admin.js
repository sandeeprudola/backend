const mongoose =require('mongoose')
const { maxLength, trim, minLength, email, boolean } = require('zod')


const AdminSchema=new mongoose.Schema({
    username:{
        type: String,
        required: true,
        maxLength: 20,
        trim: true,
        unique:true,
    },
    password:{
        type:String,
        required:true,
        minLength:8,
    },
    firstName:{
        type:String,
        required:true,
        maxlength:20,
        trim:true,
    },
    lastName:{
        type:String,
        maxlength:20,
        trim:true,
    },
    email:{
        type: String,
        maxLength:30,
        unique:true,
        lowercase: true,
        trim:true
    },
    role:{
        type: String,
        enum:["super-admin","admin"],
        default:"admin",
    },
    caninvite:{
        type: Boolean,
        default:false,
    },
},
{timestamps:true,})

module.exports=mongoose.model("admin",AdminSchema)