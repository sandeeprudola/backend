const { JWT_SECRET } = require("../config");
const jwt=require('jsonwebtoken')

function authmiddleware(roles=[]){
    return (req,res,next)=>{
        const authHeader=req.headers.authorization;
        if(!authHeader || !authHeader.startsWith("Bearer ")){
            return res.status(411).json({
                msg:"no token provided"
            })
        }

        const token= authHeader.split(" ")[1];

        try{
            const decoded = jwt.verify(token,JWT_SECRET);

            // Employee tokens use userId; some routes use id/userid — normalize so req.user.id is always the subject
            const subjectId = decoded.userId ?? decoded.userid ?? decoded.id;

            req.user={
                id: subjectId,
                role:decoded.role,
            }
            if (roles.length && !roles.includes(req.user.role)) {
                return res.status(403).json({
                  msg: "Forbidden: insufficient role",
                });
              }
            next();
        }
        catch(err){
            return res.status(401).json({
                msg:"invalid or expired token"
            })
        }
    }
}
module.exports=authmiddleware