import {similarity} from './knowledge.js';
const maintenance=/维修|维护|检修|施工|修路|改造|停服|恢复|开放/;
// Read exactly the public announcement fields; publishing an announcement makes it
// available here without creating a second, potentially stale knowledge copy.
export async function announcementSources(db,query){
 const rows=(await db.prepare('SELECT id,title,content,created_at,updated_at FROM announcements ORDER BY id DESC LIMIT 100').all()).results;
 const wantsMaintenance=maintenance.test(query),wantsNotices=/公告|通知|最新消息/.test(query);
 const ranked=rows.map(row=>({...row,score:similarity(query,row.title+' '+row.content)}))
  .filter(row=>wantsMaintenance?maintenance.test(row.title+' '+row.content):wantsNotices||row.score>=0.25)
  .sort((a,b)=>wantsMaintenance||wantsNotices?b.id-a.id:b.score-a.score||b.id-a.id).slice(0,5);
 return ranked.map(({score,...row})=>({key:'announcement:'+row.id,kind:'announcement',id:row.id,title:row.title,url:'/#notice',content:JSON.stringify(row)}));
}
