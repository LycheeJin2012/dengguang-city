import {endpoint,fail} from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{fail(410,'榜单功能已移除');});
