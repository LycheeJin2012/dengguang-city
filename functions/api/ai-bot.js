import {endpoint,identity,reply} from '../_core/request.js';
import {getOrCreateAiBot} from '../_shared/ai.js';
export const onRequestGet=c=>endpoint(async()=>{await identity(c);const p=await getOrCreateAiBot(c.env);return reply({username:p.username});});
