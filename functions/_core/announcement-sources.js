import {similarity} from './knowledge.js';

const maintenance=/维修|维护|检修|施工|修路|改造|停服|恢复|开放/;

// Read exactly the public announcement fields; publishing an announcement makes it
// available here without creating a second, potentially stale knowledge copy.
export async function announcementSources(db,query){
 const rows=(await db.prepare('SELECT id,title,content,created_at,updated_at FROM announcements ORDER BY id DESC LIMIT 100').all()).results;
 const wantsMaintenance=maintenance.test(query);
 const wantsNotices=/公告|通知|最新消息/.test(query);
 // 走维护/公告意图时不再看相似度：这类问题要的是「最新几条」，不是「最贴题的那条」。
 // 两条正则都没有 g 标志，.test() 不会残留 lastIndex，重复调用安全。
 const keep=row=>wantsMaintenance
  ?maintenance.test(row.title+' '+row.content)
  :wantsNotices||row.score>=0.25;
 const ranked=rows
  .map(row=>({...row,score:similarity(query,row.title+' '+row.content)}))
  .filter(keep)
  .sort((a,b)=>wantsMaintenance||wantsNotices?b.id-a.id:b.score-a.score||b.id-a.id)
  .slice(0,5);
 return ranked.map(({score,...row})=>({
  key:'announcement:'+row.id,
  kind:'announcement',
  id:row.id,
  title:row.title,
  url:'/#notice',
  content:JSON.stringify(row),
 }));
}
