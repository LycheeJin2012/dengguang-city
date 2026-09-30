import {myAffairs} from './my-affairs.js';
const labels={open:'待处理',in_progress:'进行中',resolved:'已办结',closed:'已结束',pending:'待审核',confirmed:'已确认',completed:'已完成',cancelled:'已取消',queued:'等待人工',active:'人工已接入',ended:'人工会话已结束',needs_review:'待复核',graded:'已批改',submitted:'已提交',passed:'已通过',failed:'未通过',generating:'生成中',grading:'批改中',abandoned:'已放弃'};
export async function personalSources(db,player,question){
 if(!player||!/(?:我|本人).{0,15}(?:事务|近况|工单|考试|酒店|预订|驾照|复核|进度|余额|绿宝石|未读|通知|提醒|待办)|^(?:最近事务|我的近况|待办提醒|查看进度)/.test(question))return null;
 const data=await myAffairs(db,player.id);
 const kinds=[];if(/工单/.test(question))kinds.push('ticket');if(/考试|成绩|复核/.test(question))kinds.push('exam','appeal');if(/酒店|预订/.test(question))kinds.push('booking');if(/驾照/.test(question))kinds.push('license');
 const selection=kinds.length?data.items.filter(r=>kinds.includes(r.kind)):data.items;
 const rows=selection.slice(0,15).map(r=>({title:r.title,status:labels[r.status]||r.status,created_at:r.created_at,...(r.kind==='exam'?{score:r.score,pending_count:r.pending_count}:{}),...(r.kind==='booking'?{in_date:r.in_date,out_date:r.out_date}:{}),attention:r.attention,...(r.admin_reply?{latest_reply:r.admin_reply.slice(0,1000),replied_at:r.replied_at}:{})}));
 const content=JSON.stringify({scope:'仅当前登录玩家的近期记录，不代表完整历史；状态是查询时快照',as_of:data.as_of,unread_notifications:data.unread_count,website_emeralds:player.emeralds,emerald_note:'网站账本余额，不是游戏背包数量，尚未同步',recent:rows});
 const fallback='以下是你当前账号的近期信息：未读通知 '+data.unread_count+' 条。'+(rows.length?'\n'+rows.slice(0,5).map(r=>r.title+'：'+r.status+(r.score!=null?'，'+r.score+' 分':'')+(r.latest_reply?'。最近回复：'+r.latest_reply.slice(0,180):'')).join('\n'):'暂时没有查到近期事务。')+'\n网站绿宝石余额 '+player.emeralds+'（与游戏背包尚未同步）。\n可在“我的事务”查看详情。这里仅显示最近记录，不代表完整历史；涉及原因或未记录结果，需要工作人员核实。';
 return {sources:[{key:'personal:current',kind:'personal',id:player.id,title:'我的事务 · 当前账号',url:'/affairs.html',content}],fallback};
}
