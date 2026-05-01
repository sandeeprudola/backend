const mongoose=require('mongoose')
const { HEARING_SERVICES, SPEECH_SERVICES } = require('../constants/serviceCatalog')

const UserSchema=new mongoose.Schema({
    username:{
        type:String,
        required:true,
        unique:true,
        trim:true,
        minLength:3,
        maxLength:30

    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password:{
        type:String,
        required:true,
        minLength:6

    },
    firstName:{
        type:String,
        required:true,
        trim:true,
        maxLength:30
    },
    lastName:{
        type:String,
        trim:true,
        maxLength:30
    },
    role:{
        type:String,
        enum: ['hearing', 'speech', 'both'],
        required:true
    },
    HearingServices:{
        type:String,
        enum:HEARING_SERVICES,
        required:true,
    },
    SpeechServices:{
        type:String,
        enum:SPEECH_SERVICES,
        required:true,
    }
},{timestamps:true})
module.exports=mongoose.model("User",UserSchema)
