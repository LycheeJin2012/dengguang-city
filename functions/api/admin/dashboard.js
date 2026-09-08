import {
  endpoint,identity,reply
}
from '../../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{
  await identity(c,'admin');const specs={
    players:['pending','active','rejected'],messages:['unread','read','done'],bookings:['pending','confirmed','completed'],license:['pending','passed','failed'],kart:['pending','approved','rejected'],circuit:['pending','approved','rejected']
  }
  ;const tables={
    license:'license_signups',kart:'kart_signups',circuit:'circuit_signups'
  }
  ;const result={
  }
  ; await Promise.all(Object.entries(specs).map(async([key,states])=>{
    const rows=await c.env.DB.prepare(`SELECT status,COUNT(*) AS n FROM ${tables[key]||key} GROUP BY status`).all();result[key]=Object.fromEntries(states.map(s=>[s,0]));result[key].total=0;for(const row of rows.results){
      result[key][row.status]=row.n;result[key].total+=row.n;
    }
  }
  ));return reply(result);
}
);
