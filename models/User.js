const mongoose=require('mongoose')
const { string, minLength, maxLength } = require('zod')
const { required } = require('zod/mini')

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
    }
})
module.exports=mongoose.model("User",UserSchema)