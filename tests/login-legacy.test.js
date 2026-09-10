import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,dispatch} from './local-d1.mjs';
import {hashPassword} from '../functions/_shared/auth.js';
import {ensureDatabase} from '../functions/_core/database.js';
async function legacy(fn){const DB=database();try{
 await DB.prepare("CREATE TABLE players(id INTEGER PRIMARY KEY,username TEXT UNIQUE,email TEXT UNIQUE,password_hash TEXT,salt TEXT,status TEXT DEFAULT 'active',emeralds INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
 const password='Legacy-local-only-55!',{hash,salt}=await hashPassword(password);
 await DB.prepare("INSERT INTO players(id,username,email,password_hash,salt,emeralds) VALUES(1,'legacy-player','legacy@example.invalid',?,?,27)").bind(hash,salt).run();
 await fn({DB,password,hash,salt});
 }finally{DB.close();}}
async function call(DB,path,method='GET',data,cookie){return dispatch(new Request('https://local.test/api/'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)}),{DB});}
test('password login on a legacy player table completes, returns a cookie and supports profile reads',()=>legacy(async({DB,password,hash,salt})=>{
 const login=await call(DB,'login','POST',{username:'legacy-player',password});assert.equal(login.status,200);const cookie=login.headers.get('Set-Cookie')?.split(';')[0];assert.ok(cookie);
 const me=await call(DB,'login','GET',undefined,cookie);assert.equal(me.status,200);const d=await me.json();assert.equal(d.player.username,'legacy-player');assert.equal(d.player.emeralds,27);assert.equal(d.player.game_id,null);assert.equal(me.headers.get('X-App-Schema-Version'),'64');assert.equal((await DB.prepare('SELECT last_login_at FROM players WHERE id=1').first()).last_login_at,null);
 const row=await DB.prepare('SELECT password_hash,salt FROM players WHERE id=1').first();assert.equal(row.password_hash,hash);assert.equal(row.salt,salt);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM audit_events').first()).n,0);
}));
test('bad passwords on legacy accounts return 401 without issuing a session',()=>legacy(async({DB})=>{
 const response=await call(DB,'login','POST',{username:'legacy-player',password:'wrong'});assert.equal(response.status,401);assert.equal(response.headers.get('Set-Cookie'),null);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n,0);
}));
test('a database already marked version 58 receives the missing player fields on upgrade',()=>legacy(async({DB,password})=>{
 await ensureDatabase(DB);await DB.prepare('ALTER TABLE players DROP COLUMN game_id').run();await DB.prepare('ALTER TABLE players DROP COLUMN last_login_at').run();await DB.prepare('DELETE FROM lc_schema_versions WHERE version>58').run();await DB.prepare('INSERT OR IGNORE INTO lc_schema_versions(version) VALUES(58)').run();
 const response=await call({...DB},'login','POST',{username:'legacy-player',password});assert.equal(response.status,200);assert.ok((await DB.prepare('PRAGMA table_info(players)').all()).results.some(r=>r.name==='game_id'));await ensureDatabase(DB);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM players').first()).n,1);
}));
