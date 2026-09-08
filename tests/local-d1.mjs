import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {onRequest as middleware} from '../functions/api/_middleware.js';
export function database(filename=':memory:'){
 const child=spawn('python3',['-u',fileURLToPath(new URL('./sqlite-bridge.py',import.meta.url)),filename]);const waiting=new Map();let id=0;
 createInterface({input:child.stdout}).on('line',line=>{const d=JSON.parse(line),w=waiting.get(d.id);waiting.delete(d.id);if(d.error)w.reject(new Error(d.error));else w.resolve(d.result);});child.stderr.on('data',d=>process.stderr.write(d));child.on('exit',()=>{for(const p of waiting.values())p.reject(new Error('SQLite process exited'));});
 const rpc=q=>new Promise((resolve,reject)=>{const n=++id;waiting.set(n,{resolve,reject});child.stdin.write(JSON.stringify({...q,id:n})+'\n');});
 class Statement{constructor(sql,params=[]){this.sql=sql;this.params=params;}bind(...params){return new Statement(this.sql,params);}all(){return rpc(this);}run(){return rpc(this);}async first(column){const r=(await this.all()).results[0]||null;return column?r?.[column]:r;}}
 return {prepare:sql=>new Statement(sql),batch:items=>rpc({batch:items.map(s=>({sql:s.sql,params:s.params}))}),close:()=>child.stdin.end()};
}
export async function dispatch(request,env){const path=new URL(request.url).pathname;if(!path.startsWith('/api/'))return new Response('Not found',{status:404});const file=new URL('../functions'+path+'.js',import.meta.url);if(!fs.existsSync(file))return new Response(JSON.stringify({ok:false,error:'接口不存在'}),{status:404,headers:{'Content-Type':'application/json'}});const m=await import(file);const context={request,env,waitUntil:p=>p.catch(console.error),next:async()=>{const key='onRequest'+request.method[0]+request.method.slice(1).toLowerCase();const fn=m[key]||m.onRequest;return fn?fn(context):new Response(JSON.stringify({ok:false,error:'方法不支持'}),{status:405,headers:{'Content-Type':'application/json'}});}};return middleware(context);}
