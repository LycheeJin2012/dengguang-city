import {endpoint,fail} from '../_core/request.js';
export const onRequestGet=c=>endpoint(async()=>{fail(403,'内部操作留痕仅供管理端监督查看');});
