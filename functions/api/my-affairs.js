import {endpoint,identity,reply} from '../_core/request.js';
import {myAffairs} from '../_core/my-affairs.js';
export const onRequestGet=c=>endpoint(async()=>{const p=await identity(c);return reply(await myAffairs(c.env.DB,p.id));});
