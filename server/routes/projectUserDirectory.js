const express=require('express');
const router=express.Router();
const db=require('../db');
const {requireAuth}=require('../services/authService');

router.get('/api/projects/:projectId/user-directory',requireAuth,async(req,res)=>{
  try{
    const globalRole=String(req.user?.role||'').toUpperCase();
    if(globalRole!=='MANAGER'){
      const membership=await db.query("select project_role from project_members where project_id=$1 and user_id=$2",[req.params.projectId,req.user.sub]);
      if(String(membership.rows[0]?.project_role||'').toUpperCase()!=='PROJECT_MANAGER')return res.status(403).json({reply:'Project Manager role is required to browse the project user directory.'});
    }
    const result=await db.query(`select id,email,display_name as "displayName",role as "globalRole" from users where is_active=true order by display_name,email`);
    res.json({ok:true,users:result.rows});
  }catch(err){res.status(500).json({reply:err.message});}
});

module.exports=router;
