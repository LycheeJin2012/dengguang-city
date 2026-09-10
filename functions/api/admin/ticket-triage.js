import {endpoint,identity,body,reply} from '../../_core/request.js';
import {ticketReference,ticketEvent} from '../../_core/ticket-policy.js';
import {accessibleTicket} from '../../_core/knowledge.js';
import {triageTicket} from '../../_core/triage.js';
export const onRequestPost=c=>endpoint(async()=>{const a=await identity(c,'admin'),b=await body(c.request),ref=ticketReference(b.ticket_id),db=c.env.DB;await accessibleTicket(db,a,ref);await db.batch([db.prepare('UPDATE ticket_triage SET manual=0,updated_by=? WHERE ticket_ref=?').bind(a.id,ref.ref),ticketEvent(db,ref.ref,{type:'admin',id:a.id,name:a.username},'triage_resumed',{})]);await triageTicket(c,ref.ref);return reply({triage:await db.prepare('SELECT * FROM ticket_triage WHERE ticket_ref=?').bind(ref.ref).first()});});
