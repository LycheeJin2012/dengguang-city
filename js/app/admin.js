import {renderMapAdmin} from './city-map.js';
import {tableCell} from './table-layout.js';
import {renderSupportChat} from './support-chat-admin.js';
import {renderReplyFeedback} from './reply-feedback-admin.js';
import {renderExamReview} from './exam-review.js';
import {renderKnowledge} from './knowledge-admin.js';
import {openExamAuthoring} from './exam-authoring.js';
import {attachTicketInsights} from './ticket-insights.js';
import {attachAiEditor} from './ai-editor.js';
import {renderDispatchPolicy} from './dispatch-policy.js';
import {renderAudit,viewAudit} from './audit-ui.js';
import {ticketTimeline,replyAuthor} from './ticket-form.js';
import {attachmentPicker,renderAttachments} from './attachments.js';
import { navigationFor, resolveNavigation } from './admin-navigation.js';
import {
  $, $$, api, post, patch, del, tr, esc, text, ticketBody, date, status, empty, title, field, modal, region, action, toast, state, session, login, csv, renderAccount
}
from './core.js';
import {
  passkeyLogin,registerPasskey
}
from './security.js';
const names={citymap:['🗺️ 地图与施工','🗺️ Map & works'],replyfeedback:['👍 回复反馈','👍 Reply feedback'],examreview:['✍️ 成绩复核','✍️ Exam review'],knowledge:['📚 知识库','📚 Knowledge base'],support:['🎧 人工客服','🎧 Human support'],owners:['🔑 酒店经营账户','🔑 Hotel owner accounts'],audit:['📒 操作留痕','📒 Operation audit'],
  dispatch:['📋 派单','📋 Dispatch'],questions:['📚 模拟题库','📚 Question bank'],tickets:['🎫 工单中心','🎫 Tickets'],players:['👥 玩家管理','👥 Citizens'],bookings:['🏨 酒店预订','🏨 Bookings'],kart:['🛞 卡丁车报名','🛞 Kart signups'],circuit:['🏁 国际试车','🏁 Circuit signups'],license:['🚗 驾照报名','🚗 License applications'],tracks:['🏎️ 赛车场管理','🏎️ Tracks'],hotels:['🏡 酒店管理','🏡 Hotels'],rooms:['🛏️ 房型管理','🛏️ Rooms'],requirements:['📝 考试要求','📝 Requirements'],announcements:['📜 公告管理','📜 Announcements'],gallery:['🖼️ 图集管理','🖼️ Gallery'],admins:['🛡️ 管理员','🛡️ Administrators'],dms:['✉️ 私信监管','✉️ DM moderation'],times:['🏆 成绩审核','🏆 Race verification'],password:['🔑 账号安全','🔑 Security']
}
;
const resources={
  tracks:{
    path:'race-tracks',key:'tracks',fields:[['name','名称'],['length_km','长度 km','number'],['laps','圈数','number'],['difficulty','难度'],['trial_price','试车价格 💎','number'],['description','介绍','textarea'],['image_url','图片 URL'],['sort_order','排序','number'],['is_active','开放','checkbox']]
  }
  ,hotels:{
    path:'hotels',key:'hotels',fields:[['owner_id','经营账户','select'],['name','酒店名'],['address','地址'],['description','介绍','textarea'],['image_url','图片 URL'],['sort_order','排序','number'],['is_active','开放','checkbox']]
  }
  ,rooms:{
    path:'hotel-rooms',key:'rooms',fields:[['hotel_id','所属酒店 ID','number'],['name','房型名'],['capacity','最大人数','number'],['beds','床型'],['price_per_night','每晚价格 💎','number'],['breakfast_included','包含早餐','checkbox'],['description','介绍','textarea'],['image_url','图片 URL'],['sort_order','排序','number'],['is_active','开放','checkbox']]
  }
  ,requirements:{
    path:'license-req',key:'requirements',fields:[['exam_type','考试类型','select'],['title','标题'],['requirements','要求','textarea'],['description','介绍','textarea'],['min_age','最低年龄','number'],['duration_minutes','考试分钟','number'],['sort_order','排序','number'],['is_active','开放','checkbox']]
  }
  ,announcements:{
    path:'announcements',key:'announcements',fields:[['title','标题'],['content','正文','textarea'],['image_url','封面 URL']]
  }
  ,gallery:{
    path:'gallery',key:'items',fields:[['cat','分类','select'],['is_featured','精选图片','checkbox'],['num','编号','number'],['title','标题'],['caption','说明','textarea'],['image_url','图片 URL'],['sort_order','排序','number'],['is_active','显示','checkbox']]
  }
}
;
let active='tickets',view,root;
let historyBound=false;

const isSuper=()=>state.session?.user?.role==='super';
const canHandleTicket=t=>t.target_admin_id!==state.session?.user?.id&&(!t.target_player_id||t.target_player_id!==state.session?.user?.linked_player_id);
async function refreshStats() {
  await region($('#admin-stats', root), () => api('/api/admin/dashboard'), (data, box) => {
    const racePending = data.kart && data.circuit ? data.kart.pending + data.circuit.pending : null;
    const stats = [
      ['players', data.players?.pending, '待审玩家', 'Pending citizens'],
      ['tickets', data.tickets?.open, '待处理工单', 'Pending tickets'],
      ['bookings', data.bookings?.pending, '待审酒店', 'Pending bookings'],
      ['license', data.license?.pending, '待审驾照', 'Pending licenses'],
      ['circuit', racePending, '待审赛道', 'Pending races'],
      ['players', data.players?.active, '活跃市民', 'Active citizens'],
    ];
    box.innerHTML = `<div class="stats">${stats.map(([key, count, zh, en]) =>
      `<button class="stat" data-open="${key}"><strong>${count ?? '—'}</strong><span>${tr(zh, en)}</span>${count == null ? `<small>${tr('暂不可用，请重试', 'Unavailable; retry')}</small>` : ''}</button>`
    ).join('')}</div>${data.partial ? `<p class="form-error" role="status">${tr('部分统计暂时无法读取，其余功能仍可使用。可点击“刷新概览”重试。', 'Some statistics are unavailable. Other functions remain usable. Refresh the overview to retry.')}</p>` : ''}<small>${tr('更新时间', 'Updated')} ${date(new Date().toISOString())}</small>`;
    $$('[data-open]', box).forEach(button => button.onclick = () => switchTab(button.dataset.open));
  });
}

function table(box,columns,rows,actions=[]){
  box.innerHTML=rows.length?`<div class="table-wrap"><table class="responsive-table" role="table"><thead><tr role="row">${columns.map(([k,l])=>`<th scope="col">${esc(l)}</th>`).join('')}${actions.length?`<th scope="col">${tr('操作','Actions')}</th>`:''}</tr></thead><tbody>${rows.map((r,i)=>`<tr role="row">${columns.map(([k,l,format])=>tableCell(l,format?format(r[k],r):esc(r[k]??'—'),['title','content','name','note','body'].includes(k)?'wrap':'')).join('')}${actions.length?`<td role="cell" class="table-actions"><span class="cell-label" aria-hidden="true">${tr('操作','Actions')}</span><div class="actions compact">${actions.filter(a=>!a.when||a.when(r)).map(a=>`<button type="button" data-row="${i}" data-action="${a.key}" class="${a.danger?'danger':''}">${esc(a.label)}</button>`).join('')}</div></td>`:''}</tr>`).join('')}</tbody></table></div>`:empty();
  $$('[data-action]',box).forEach(b=>b.onclick=()=>action(b,()=>actions.find(a=>a.key===b.dataset.action).run(rows[+b.dataset.row])));
}
function toolbar({
  search=true,options=[],create,extra=''
}
={
}
){
  view.innerHTML=`<div class="section-head"><h2>${tr(...names[active])}</h2><button id="reload-tab">↻ ${tr('刷新','Refresh')}</button></div><div class="toolbar">${search?field('q',tr('搜索','Search'),'search','',{
    required:false
  }
  ):''}${options.length?field('status',tr('状态','Status'),'select','',{
    required:false,options:[['',tr('全部','All')],...options]
  }
  ):''}${create?`<button id="create-record" class="primary">＋ ${tr('新建','New')}</button>`:''}<button id="export">↓ CSV</button>${extra}</div><div id="records"></div>`;
  $('#reload-tab',view).onclick=()=>loadActive();
  $('#create-record',view)?.addEventListener('click',create);
}
function bindList(load){
  let timer;
  $$('.toolbar input,.toolbar select',view).forEach(e=>e.addEventListener('input',()=>{
    clearTimeout(timer);timer=setTimeout(load,180);
  }
  ));
  return load();
}
function params(){
  const p=new URLSearchParams({
    limit:'200'
  }
  );
  $$('.toolbar [name]',view).forEach(e=>{
    if(e.value)p.set(e.name,e.value);
  }
  );
  return p;
}
function attachExport(rows){
  $('#export',view).onclick=()=>csv(`light-city-${active}.csv`,rows);
}
async function resourceList(def){
  const view=root.querySelector('#admin-view');
  const editor=async(item={
  }
  )=>{
    const defaults={
      is_active:1,capacity:2,price_per_night:0,trial_price:0,sort_order:0,laps:1,num:1,duration_minutes:30,min_age:0,exam_type:'B',breakfast_included:1
    }
    ;
    let fields=def.fields.map(([key,label,type='text'])=>field(key,tr(label,key.replaceAll('_',' ')),type,item[key]??defaults[key]??'',{
      required:['name','title','content','hotel_id'].includes(key),min:type==='number'?0:undefined,step:key==='length_km'?'0.01':undefined,options:key==='cat'?[['city',tr('城市','City')],['road',tr('道路','Roads')],['kart',tr('卡丁车','Kart')],['nature',tr('自然','Nature')],['announcement',tr('公告','Announcement')]]:[['B',tr('B 级','Grade B')],['A',tr('A 级','Grade A')],['S',tr('S 级','Grade S')],['written',tr('笔试','Written')],['road',tr('路考','Road test')],['upgrade',tr('升级考试','Upgrade')]]
    }
    )).join('');
    if(active==='hotels'){
      const owners=await api('/api/admin/hotel-owners');
      fields=def.fields.filter(f=>f[0]!=='owner_id').map(([key,label,type='text'])=>field(key,tr(label,key),type,item[key]??defaults[key]??'',{required:key==='name',min:0})).join('')+field('owner_id',tr('分配酒店老板','Hotel owner'),'select',item.owner_id||'',{required:false,options:[['',tr('暂未分配','Unassigned')],...owners.owners.filter(o=>o.status==='active').map(o=>[o.id,`#${o.id} · ${o.username}`])]});
    }
    if(active==='rooms'){
      const h=await api('/api/admin/hotels');
      fields=field('hotel_id',tr('所属酒店','Hotel'),'select',item.hotel_id||h.hotels[0]?.id,{
        options:h.hotels.map(h=>[h.id,h.name])
      }
      )+def.fields.filter(f=>f[0]!=='hotel_id').map(([key,label,type='text'])=>field(key,tr(label,key),type,item[key]??defaults[key]??'',{
        required:['name','price_per_night','capacity'].includes(key),min:0
      }
      )).join('');
    }
    let picker;
    const dialog = modal(tr(item.id?'编辑记录':'新建记录',item.id?'Edit record':'New record'),fields,{
      submit:async d=>{
        if(picker){const files=picker.files();if(files.length)d.image_url=files[0].url;}
        await (item.id?patch('/api/admin/'+def.path+'?id='+item.id,d):post('/api/admin/'+def.path,d));picker?.commit();toast(tr('保存成功','Saved'));await load();
      }
    }
    );
    if(def.fields.some(f=>f[0]==='image_url'))picker=attachmentPicker(dialog,{purpose:'public-image',max:1});
  }
  ;
  toolbar({
    create:isSuper()?()=>editor():null
  }
  );
  const load=()=>region($('#records',view),()=>api('/api/admin/'+def.path),(d,box)=>{
    let rows=d[def.key]||[];const q=$('[name=q]',view).value.trim().toLowerCase();if(q)rows=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q));attachExport(rows);table(box,[['id','ID'],[def.key==='announcements'||def.key==='items'||def.key==='requirements'?'title':'name',tr('名称','Name')],...('is_active' in (rows[0]||{
    }
    )?[['is_active',tr('状态','Status'),v=>status(v?'active':'pending')]]:[]),['updated_at',tr('更新时间','Updated'),date]],rows,isSuper()?[{
      key:'edit',label:tr('编辑','Edit'),run:editor
    },{key:'history',label:tr('操作记录','History'),run:r=>viewAudit(({hotels:'hotels','hotel-rooms':'hotel_rooms','race-tracks':'race_tracks','license-req':'license_requirements',announcements:'announcements',gallery:'gallery_items'})[def.path],r.id)
    }
    ,{
      key:'delete',label:tr('删除','Delete'),danger:true,run:async r=>{
        if(!confirm(tr('删除这条记录？有历史关联的数据不能删除。','Delete this record? Historical references will prevent deletion.')))return;await del('/api/admin/'+def.path+'?id='+r.id);await load();
      }
    }
    ]:[]);
  }
  );
  await bindList(load);
}
async function signups(kind){
  const view=root.querySelector('#admin-view');
  const opts=kind==='bookings'?['pending','confirmed','completed','cancelled']:kind==='license'?['pending','passed','failed']:['pending','approved','rejected'];
  toolbar({
    options:opts
  }
  );
  const load=()=>region($('#records',view),()=>api('/api/admin/'+kind),(d,box)=>{
    let rows=d.bookings||d.signups||[];const p=params();rows=rows.filter(r=>(!p.get('status')||r.status===p.get('status'))&&(!p.get('q')||JSON.stringify(r).includes(p.get('q'))));attachExport(rows);table(box,[['id','ID'],['player_username',tr('市民','Citizen')],[kind==='bookings'?'room_name':kind==='license'?'exam_type':'session',tr('项目','Item')],['contact',tr('联系','Contact')],['note',tr('备注','Notes')],['status',tr('状态','Status'),status],['created_at',tr('提交时间','Created'),date]],rows,[{
      key:'review',label:tr('处理','Review'),run:async r=>{
        modal(tr('处理报名','Review application'),field('status',tr('状态','Status'),'select',r.status,{
          options:opts
        }
        )+field('note',tr('备注','Notes'),'textarea',r.note||'',{
          required:false
        }
        ),{
          submit:async values=>{
            await patch(`/api/admin/${kind}?id=${r.id}&status=${values.status}`,values);await load();refreshStats();
          }
        }
        );
      }
    }
    ]);
  }
  );
  await bindList(load);
}
async function players(){
  const view=root.querySelector('#admin-view');
  toolbar({
    options:['pending','active','rejected'],create:isSuper()?()=>modal(tr('创建市民账号','Create citizen'),field('username',tr('游戏 ID','Game ID'))+field('email',tr('邮箱','Email'),'email')+field('password',tr('初始密码','Initial password'),'password'),{
      submit:async d=>{
        await post('/api/init?action=admin-player-create',d);await load();
      }
    }
    ):null
  }
  );
  const load=()=>region($('#records',view),()=>api('/api/admin/players?'+params()),(d,box)=>{
    attachExport(d.players);table(box,[['id','ID'],['username',tr('游戏 ID','Game ID')],['email',tr('邮箱','Email')],['emeralds','💎'],['status',tr('状态','Status'),status]],d.players,[{key:'audit',label:tr('操作记录','History'),when:isSuper,run:r=>viewAudit('players',r.id)},{
      key:'approve',label:tr('批准','Approve'),when:r=>r.status!=='active',run:async r=>{
        await patch('/api/admin/players?id='+r.id+'&action=approve');await load();refreshStats();
      }
    }
    ,{
      key:'reject',label:tr('停用','Disable'),when:r=>r.status!=='rejected',run:async r=>{
        if(!confirm(tr('停用此市民账号？','Disable this account?')))return;await patch('/api/admin/players?id='+r.id+'&action=reject');await load();refreshStats();
      }
    }
    ,{
      key:'reset',label:tr('重置密码','Reset password'),when:isSuper,run:async r=>modal(tr('重置密码','Reset password'),field('new_password',tr('新密码','New password'),'password'),{
        submit:d=>patch('/api/admin/players?id='+r.id+'&action=reset',d)
      }
      )
    }
    ,{
      key:'rename',label:tr('改名','Rename'),when:isSuper,run:async r=>modal(tr('修改游戏 ID','Rename'),field('new_username',tr('游戏 ID','Game ID'),'text',r.username),{
        submit:async d=>{
          await patch('/api/admin/players?id='+r.id+'&action=rename',d);await load();
        }
      }
      )
    }
    ]);
  }
  );
  await bindList(load);
}
async function tickets(){
  const view=root.querySelector('#admin-view');
  const dispatching=active==='dispatch';
  let adminNames=new Map();
  toolbar({
    options:['open','in_progress','resolved','closed'],extra:field('assignment',tr('派单状态','Assignment'),'select',dispatching?'unassigned':'',{required:false,options:[['',tr('全部','All')],['unassigned',tr('未派单','Unassigned')],['mine',tr('派给我','Assigned to me')]]})+field('category',tr('分类','Category'),'select','',{
      required:false,options:[['',tr('全部分类','All categories')],['message','留言'],['support','人工客服'],['hotel','酒店'],['license','驾照'],['race','赛车'],['kart','卡丁车'],['service','服务']]
    }
    )
  }
  );
  if(active==='support')$('[name=category]',view).value='support';
  if(dispatching){$('[name=status]',view).value='open';const policy=document.createElement('section');view.prepend(policy);region(policy,()=>null,()=>renderDispatchPolicy(policy));}
  const load=()=>region($('#records',view),async()=>{const [tickets,admins]=await Promise.all([api('/api/tickets?'+params()),api('/api/admin/admins')]);adminNames=new Map(admins.admins.map(a=>[a.id,a.username]));return tickets;},(d,box)=>{
    attachExport(d.tickets);table(box,[['id','ID'],['title',tr('标题','Title')],['player_username',tr('市民','Citizen')],['category',tr('分类','Category'),category=>esc(({support:tr('人工客服','Human support'),message:tr('留言','Message'),hotel:tr('酒店','Hotel'),license:tr('驾照','License'),race:tr('赛车','Race'),kart:tr('卡丁车','Kart'),service:tr('服务','Service'),comment:tr('评论','Comment')})[category]||category)],['status',tr('状态','Status'),status],['priority',tr('内部优先级','Internal priority'),v=>esc(({low:'低',normal:'普通',high:'高',urgent:'紧急'})[v]||v)],['triage_urgency',tr('紧急程度','Urgency'),v=>esc(({routine:'常规',time_sensitive:'需尽快处理',emergency:'紧急风险'})[v]||'—')],['attachment_count',tr('附件','Attachments'),n=>n?'📎 '+Number(n):'—'],['assignee_id',tr('承办人','Assignee'),id=>esc(id?adminNames.get(id)||'#'+id:tr('未派单','Unassigned'))]],d.tickets,[{
      key:'assign',label:tr('派单','Assign'),when:canHandleTicket,run:async ticket=>{
        const data=await api('/api/admin/admins');
        modal(tr('派单 · ','Assign · ')+ticket.title,field('assignee_id',tr('承办管理员','Assign to'),'select',ticket.assignee_id||'',{required:false,options:[['',tr('取消派单','Unassign')],...data.admins.map(a=>[a.id,a.username])]}),{label:tr('确认派单','Confirm assignment'),submit:async values=>{await patch('/api/tickets?id='+encodeURIComponent(ticket.id),{assignee_id:values.assignee_id?Number(values.assignee_id):null});toast(tr('派单已保存','Assignment saved'));await load();}});
      }
    },{
      key:'ai',label:tr('自动补派','Auto assign'),when:t=>canHandleTicket(t)&&!t.assignee_id&&!t.dispatch_hold,run:async ticket=>{
        const result=await post('/api/admin/auto-dispatch?id='+encodeURIComponent(ticket.id),{});
        toast(result.status==='assigned'?tr('已自动派给 ','Assigned to ')+result.admin.username:result.reason);await load();refreshStats();
      }
    },{
      key:'detail',label:tr('处理工单','Review ticket'),run:async r=>{
        const data=await api('/api/tickets?id='+r.id),t=data.ticket;const admins=await api('/api/admin/admins');let ticketUploads;const dialog=modal(tr('工单 #','Ticket #')+r.id,`<div class="wide notice"><b>${esc(t.title)}</b><p>${tr('公开授权','Public consent')}：${tr(t.public_consent?'已同意':'未同意',t.public_consent?'Granted':'Not granted')}</p>${t.target_admin_id?`<p>${tr('被投诉管理员','Reported administrator')} #${t.target_admin_id}</p>`:''}${t.target_player_name?`<p>${tr('被举报玩家','Reported player')}：${esc(t.target_player_name)} ${t.target_player_id?'#'+t.target_player_id:tr('（自填）','(entered)')}</p>`:''}<div>${ticketBody(t.body)}</div>${t.replied_by?`<p><b>${esc(replyAuthor(t))}</b> · ${date(t.replied_at)}</p>`:''}${t.auto_reply?`<div class="notice"><b>${tr('灯灯 · 自动基础回复','DengDeng · Automatic first reply')}</b><p>${text(t.auto_reply)}</p></div>`:''}${t.triage?`<aside class="notice" id="internal-triage"><b>内部评估（仅管理端）</b><p>优先级：${esc(({low:'低',normal:'普通',high:'高',urgent:'紧急'})[t.triage.priority])} · 紧急程度：${esc(({routine:'常规',time_sensitive:'需尽快处理',emergency:'紧急风险'})[t.triage.urgency])} · 复杂度：${t.triage.complexity==='complex'?'复杂':'一般'}</p><p>${text(t.triage.reason)}</p><small>${t.triage.source==='ai'?'AI 判断':t.triage.source==='manual'?'人工调整':'规则判断'} · ${date(t.triage.updated_at)}</small></aside>`:''}${t.feedback?.length?`<aside class="notice"><b>回复反馈（内部监督）</b>${t.feedback.map(f=>`<p><b>${f.helpful?'有用':'未解决'}</b> · 回复记录 #${esc(f.target_id)} · ${date(f.updated_at)}<br>${esc(t.history?.find(e=>e.id===Number(f.target_id))?.actor_name||'客服回复')} · ${esc(f.reason)} · ${text(f.comment)}</p>`).join('')}</aside>`:''}${renderAttachments(t.attachments)}${t.reward?`<p class="notice">${tr('承办奖励','Handler reward')}：${t.reward.amount} 💎 · ${tr(t.reward.paid?'已发放':'待绑定玩家后发放',t.reward.paid?'Paid':'Pending linked citizen')} · ${tr('承办管理员','Assignee')} #${t.reward.admin_id}</p>`:''}${ticketTimeline(t.history)}</div>`+field('status',tr('状态','Status'),'select',t.status,{
          options:['open','in_progress','resolved','closed']
        }
        )+field('priority',tr('优先级','Priority'),'select',t.priority||'normal',{
          options:['low','normal','high','urgent']
        }
        )+field('assignee_id',tr('指派管理员','Assign to'),'select',t.assignee_id||'',{
          required:false,options:[['',tr('未指派','Unassigned')],...admins.admins.map(a=>[a.id,a.username])]
        }
        )+field('admin_reply',tr('回复内容','Reply'),'textarea',t.admin_reply||'',{
          required:false
        }
        )+`<details class="wide"><summary>${tr('公开处理设置','Public processing settings')}</summary><p class="muted">${tr('只有提交者同意后才可公开。请先删除联系方式、无关个人信息等敏感内容；附件始终不公开。','Consent is required. Remove contact details and unrelated personal information; attachments remain private.')}</p>${field('public_visible',tr('发布到公开处理列表','Publish to public feed'),'checkbox',t.public_visible)}${field('public_title',tr('公开标题','Public title'),'text',t.public_title||t.title,{required:false,maxlength:120})}${field('public_body',tr('公开文字','Public text'),'textarea',t.public_body||t.body,{required:false})}${field('public_reply',tr('公开答复','Public reply'),'textarea',t.public_reply||t.admin_reply||'',{required:false})}</details>`,{
          wide:true,submit:canHandleTicket(t)?async values=>{
            const saved=await patch('/api/tickets?id='+r.id,{
              ...values,attachment_ids:ticketUploads?ticketUploads.ids():[],assignee_id:values.assignee_id?Number(values.assignee_id):null
            }
            );

ticketUploads?.commit();await load();refreshStats();if(saved.reward?.amount)toast(tr('办结成功，10 绿宝石已发放至 ','Completed. 10 emeralds credited to ')+saved.reward.player_name);else if(saved.reward?.pending)toast(tr('已办结，奖励将在承办人绑定玩家账号后发放','Completed; reward is pending a linked citizen account'));else toast(tr('已保存','Saved'));
          }:null
        }
        );
          $('[name=public_visible]',dialog).disabled=!t.public_consent;
          if(canHandleTicket(t)&&t.assignee_id&&t.status!=='resolved'&&(isSuper()||t.assignee_id===state.session.user.id)){const finish=document.createElement('button');finish.type='button';finish.className='primary';finish.textContent=tr('办结工单 · 奖励 10 💎','Complete ticket · 10 💎');$('.modal-body > .actions',dialog).prepend(finish);finish.onclick=()=>{$('[name=status]',dialog).value='resolved';$('form',dialog).requestSubmit();};}
          const remaining=5-(t.attachments||[]).length;if(canHandleTicket(t)&&remaining>0)ticketUploads=attachmentPicker(dialog,{max:remaining,existingBytes:(t.attachments||[]).reduce((sum,file)=>sum+file.size,0)});
          if(!canHandleTicket(t)){$$('input,select,textarea',dialog).forEach(input=>input.disabled=true);$('.modal-body',dialog).insertAdjacentHTML('afterbegin',`<p class="notice">${tr('该工单涉及你本人，请由其他超管处理。','This complaint involves you; another super administrator must handle it.')}</p>`);return;}
          if(t.triage?.manual){const resume=document.createElement('button');resume.type='button';resume.textContent='恢复自动分级';$('.modal-body > .actions',dialog).prepend(resume);resume.onclick=e=>action(e.currentTarget,async()=>{const d=await post('/api/admin/ticket-triage',{ticket_id:t.id});if(d.triage?.manual)throw new Error('期间已有其他管理员调整分级，已保留人工设置，请刷新查看');if(d.triage){$('[name=priority]',dialog).value=d.triage.priority;$('#internal-triage',dialog).innerHTML='<b>内部评估（仅管理端）</b><p>'+esc(d.triage.priority+' / '+d.triage.urgency+' / '+d.triage.complexity)+'</p><p>'+text(d.triage.reason)+'</p><small>'+esc(d.triage.source==='ai'?'AI 判断':'规则判断')+'</small>';resume.remove();}toast('已恢复自动分级，回复草稿保留');});}
          attachAiEditor(dialog,{ticketId:t.id,targetName:'admin_reply'});attachTicketInsights(dialog,t.id);
          if(isSuper()){const history=document.createElement('button');history.type='button';history.textContent=tr('查看完整操作留痕','View complete audit');$('.modal-body > .actions',dialog).prepend(history);history.onclick=()=>viewAudit('tickets',t.id);}
      }
    }
    ]);
  }
  );
  await bindList(load);
}
async function admins(){
  const view=root.querySelector('#admin-view');
  toolbar({
    create:()=>edit()
  }
  );
  function edit(r={
  }
  ){
    modal(tr(r.id?'编辑管理员':'新增管理员',r.id?'Edit administrator':'New administrator'),field('username',tr('账号','Username'),'text',r.username||'')+field(r.id?'new_password':'password',tr(r.id?'新密码（留空不改）':'密码',r.id?'New password (optional)':'Password'),'password','',{
      required:!r.id
    }
    )+field('role',tr('角色','Role'),'select',r.role||'admin',{
      options:['admin','super']
    }
    )+field('specialties',tr('职责与擅长事项','Responsibilities / specialties'),'text',r.specialties||'',{required:false,maxlength:300}),{
      submit:async d=>{
        if(!d.new_password)delete d.new_password;await (r.id?patch('/api/admin/admins?id='+r.id,d):post('/api/admin/admins',d));await load();
      }
    }
    );
  }
  const load=()=>region($('#records',view),()=>api('/api/admin/admins'),(d,box)=>{
    attachExport(d.admins);table(box,[['id','ID'],['username',tr('账号','Username')],['role',tr('角色','Role')],['linked_player_username',tr('绑定市民','Linked citizen')]],d.admins,[{key:'audit',label:tr('操作记录','History'),run:r=>viewAudit('admins',r.id)},{
      key:'edit',label:tr('编辑','Edit'),run:edit
    }
    ,{
      key:'link',label:tr('绑定/解绑','Link / unlink'),run:r=>modal(tr('关联市民账号','Link citizen account'),field('player_id',tr('市民 ID（留空解绑）','Citizen ID (empty to unlink)'),'number',r.linked_player_id||'',{
        required:false,min:1
      }
      ),{
        submit:async d=>{
          await post('/api/init?action=admin-'+(d.player_id?'merge-account':'unmerge-account'),{
            admin_id:r.id,player_id:d.player_id||r.linked_player_id
          }
          );await load();
        }
      }
      )
    }
    ,{
      key:'delete',label:tr('删除','Delete'),danger:true,when:r=>r.id!==state.session.user.id,run:async r=>{
        if(confirm(tr('确定删除此管理员？','Delete this administrator?'))){
          await del('/api/admin/admins?id='+r.id);await load();
        }
      }
    }
    ]);
  }
  );
  await bindList(load);
}
async function dms(){
  const view=root.querySelector('#admin-view');
  toolbar();
  const load=()=>region($('#records',view),()=>post('/api/init?action=admin-dm-conversations',{
    q:$('[name=q]',view).value
  }
  ),(d,box)=>{
    attachExport(d.conversations);table(box,[['from_username',tr('发送方','From')],['to_username',tr('接收方','To')],['last_content',tr('最近消息','Last message')]],d.conversations,[{
      key:'open',label:tr('查看与回复','View & reply'),run:async r=>{
        const d=await post('/api/init?action=admin-dm-thread',{
          from_player_id:r.from_player_id,to_player_id:r.to_player_id
        }
        );const dialog=modal(tr('私信监管','DM moderation'),`<div class="wide">${d.messages.map(m=>`<div class="row"><small>#${m.from_player_id} · ${date(m.created_at)}</small><p>${text(m.content)}</p></div>`).join('')}</div>`+field('content',tr('管理员回复','Admin reply'),'textarea'),{
          wide:true,submit:async v=>{
            await post('/api/init?action=admin-dm-reply',{
              from_player_id:r.to_player_id,to_player_id:r.from_username==='灯灯客服'?r.to_player_id:r.from_player_id,content:v.content
            }
            );await load();
          }
        }
        );
        attachAiEditor(dialog,{targetName:'content',endpoint:'/api/init?action=admin-dm-ai-suggest',context:d.messages.slice(-8).map(m=>m.content).join('\n').slice(-4000)});
      }
    }
    ]);
  }
  );
  await bindList(load);
}
async function times(){
  const view=root.querySelector('#admin-view');
  toolbar({
    search:false
  }
  );
  await region($('#records',view),()=>api('/api/admin/race-times'),(d,box)=>{
    attachExport(d.times);table(box,[['player_username',tr('市民','Citizen')],['track_name',tr('赛道','Track')],['time_ms',tr('毫秒','Milliseconds')],['verified',tr('已认证','Verified'),v=>v?'✓':'—']],d.times,[{
      key:'verify',label:tr('切换认证','Toggle verification'),run:async r=>{
        await patch(`/api/race-times?id=${r.id}&action=${r.verified?'unverify':'verify'}`);await times();
      }
    }
    ]);
  }
  );
}
async function questions(){
  const view=root.querySelector('#admin-view');
  toolbar({
    create:()=>edit()
  }
  );
  const aiButton=document.createElement('button');aiButton.textContent=tr('AI 出驾照题目','AI question authoring');aiButton.onclick=()=>action(aiButton,()=>openExamAuthoring(load));$('.toolbar',view).append(aiButton);
  const load=()=>region($('#records',view),()=>api('/api/admin/exam-questions'),(d,box)=>{
    attachExport(d.questions);table(box,[['id','ID'],['grade',tr('等级','Grade')],['question',tr('题目','Question')],['answer',tr('答案','Answer')]],d.questions,[{
      key:'edit',label:tr('编辑','Edit'),run:edit
    }
    ]);
  }
  );
  function edit(q={
  }
  ){
    modal(tr('模拟题库','Question bank'),field('grade',tr('等级','Grade'),'select',q.grade||'B',{
      options:['B','A','S']
    }
    )+field('q_type',tr('类型','Type'),'select',q.q_type||'choice',{
      options:['choice','multi','judge']
    }
    )+field('question',tr('题目','Question'),'textarea',q.question||'')+field('options',tr('选项（每行一项，判断题可留空）','Options (one per line; empty for true/false)'),'textarea',q.options?JSON.parse(q.options).join('\n'):'',{
      required:false
    }
    )+field('answer',tr('答案（A / A|B / true / false）','Answer (A / A|B / true / false)'),'text',q.answer||'')+field('explanation',tr('解析','Explanation'),'textarea',q.explanation||'',{
      required:false
    }
    ),{
      submit:async d=>{
        d.options=d.options.split('\n').map(s=>s.trim()).filter(Boolean);await(q.id?patch('/api/admin/exam-questions?id='+q.id,d):post('/api/admin/exam-questions',d));await load();
      }
    }
    );
  }
  await load();
}
async function password(){
  const view=root.querySelector('#admin-view');
  view.innerHTML=`<div class="panel"><h2>${tr('管理员账号安全','Administrator security')}</h2><p>${tr('修改管理密码不影响绑定的市民密码。','Changing your admin password does not change your citizen password.')}</p><div class="actions"><button id="change-password">${tr('修改密码','Change password')}</button><button id="admin-add-key">${tr('添加通行密钥','Add passkey')}</button><button id="admin-list-keys">${tr('管理通行密钥','Manage passkeys')}</button></div></div>`;
  $('#change-password',view).onclick=()=>modal(tr('修改管理员密码','Change admin password'),field('old_password',tr('当前密码','Current password'),'password')+field('new_password',tr('新密码','New password'),'password')+field('confirm',tr('再次输入新密码','Confirm new password'),'password'),{
    submit:async d=>{
      if(d.new_password!==d.confirm)throw new Error(tr('两次密码不一致','Passwords do not match'));await post('/api/admin/change-password',d);toast(tr('密码已修改','Password changed'));
    }
  }
  );
  $('#admin-add-key',view).onclick=()=>modal(tr('添加通行密钥','Add passkey'),field('name',tr('设备名称','Device name'),'text','Admin device'),{
    submit:async d=>{
      await registerPasskey(d.name);toast(tr('已添加通行密钥','Passkey added'));
    }
  }
  );
  $('#admin-list-keys',view).onclick=async()=>{
    const d=await post('/api/init?action=passkey-list');
    const dialog=modal(tr('管理通行密钥','Manage passkeys'),'<div class="wide">'+(d.passkeys.map(k=>`<div class="row row-head"><span>${esc(k.name)}</span><button type="button" data-key="${k.id}">${tr('移除','Remove')}</button></div>`).join('')||empty())+'</div>');
    $$('[data-key]',dialog).forEach(b=>b.onclick=e=>action(e.currentTarget,async()=>{
      if(confirm(tr('移除此通行密钥？','Remove this passkey?'))){
        await post('/api/init?action=passkey-delete',{
          id:+b.dataset.key
        }
        );b.closest('.row').remove();
      }
    }
    ));
  }
  ;
}
async function owners(){
 const view=root.querySelector('#admin-view');toolbar({create:()=>edit()});
 const load=()=>region($('#records',view),()=>api('/api/admin/hotel-owners'),(d,box)=>{attachExport(d.owners);table(box,[['id','ID'],['username',tr('经营账号','Owner account')],['player_username',tr('绑定玩家','Linked citizen')],['hotel_count',tr('酒店数量','Hotels')],['status',tr('状态','Status'),status]],d.owners,[{key:'edit',label:tr('编辑 / 停用','Edit / disable'),run:edit},{key:'audit',label:tr('操作记录','History'),run:r=>viewAudit('hotel_owners',r.id)}]);});
 async function edit(owner={}){const d=await api('/api/admin/players');modal(tr(owner.id?'编辑酒店老板账户':'创建酒店老板账户',owner.id?'Edit hotel owner':'Create hotel owner'),field('username',tr('经营账号','Username'),'text',owner.username||'')+field(owner.id?'new_password':'password',tr(owner.id?'新密码（留空不改）':'初始密码',owner.id?'New password (optional)':'Initial password'),'password','',{required:!owner.id})+field('linked_player_id',tr('关联玩家（可选）','Linked citizen (optional)'),'select',owner.linked_player_id||'',{required:false,options:[['',tr('不关联','None')],...d.players.filter(p=>p.status==='active').map(p=>[p.id,`#${p.id} · ${p.username}`])]})+field('status',tr('状态','Status'),'select',owner.status||'active',{options:[['active',tr('启用','Active')],['disabled',tr('停用','Disabled')]]})+`<p class="muted wide">${tr('创建后，在酒店管理中将酒店分配给此经营账户。关联玩家后，该玩家首页会显示“我的酒店”。','After creation, assign hotels from Hotel management. Linked citizens will see My hotel.')}</p>`,{submit:async values=>{if(!values.new_password)delete values.new_password;await(owner.id?patch('/api/admin/hotel-owners?id='+owner.id,values):post('/api/admin/hotel-owners',values));await load();}});}
 await load();
}
async function loadActive(){
  const page=active;
  try{
    if(page==='replyfeedback')await renderReplyFeedback(view);
    else if(page==='examreview')await renderExamReview(view);
    else if(page==='citymap')await renderMapAdmin(view);
    else if(page==='knowledge')await renderKnowledge(view);
    else if(page==='support')await renderSupportChat(view);
    else if(page==='audit')await renderAudit(view);
    else if(resources[page])await resourceList(resources[page]);
    else if(['bookings','kart','circuit','license'].includes(page))await signups(page);
    else await ({
      tickets,dispatch:tickets,players,admins,dms,times,questions,password,owners
    }
    [page])();
  }
  catch(e){
    if(page===active)view.innerHTML=`<div class="empty error">${esc(e.message)}</div>`;
  }
}
function switchTab(key) {
  let selected = resolveNavigation(key, isSuper());
  active = selected.child;
  location.hash = active;
  $$('.admin-nav [data-group]', root).forEach(button => button.setAttribute('aria-selected', button.dataset.group === selected.group.id));
  const section = document.createElement('section');
  section.className = 'admin-content';
  section.id = 'admin-section';
  if (selected.group.children.length > 1) {
    const tabs = document.createElement('nav');
    tabs.className = 'tabs';
    tabs.setAttribute('aria-label', tr(...selected.group.label));
    tabs.innerHTML = selected.group.children.map(child => `<button data-child="${child}" aria-selected="${child === active}">${tr(...names[child])}</button>`).join('');
    tabs.querySelectorAll('[data-child]').forEach(button => button.onclick = () => switchTab(button.dataset.child));
    section.append(tabs);
  }
  const next = document.createElement('section');
  next.id = 'admin-view';
  section.append(next);
  $('#admin-section', root).replaceWith(section);
  view = next;
  loadActive();
}
export async function render(el){
  root=el;
  if(!historyBound){window.addEventListener('hashchange',()=>{const key=location.hash.slice(1);if(root?.isConnected&&state.session?.admin&&resolveNavigation(key,isSuper()).child!==active)switchTab(key);});historyBound=true;}
  if(!state.session?.admin){
    const player=state.session?.player,linked=!!player?.linked_admin_id;
    el.innerHTML=title('市政管理后台','City administration')+`<div class="panel"><h2>${tr('通过绑定玩家账号辅助登录','Sign in with your linked citizen account')}</h2><p>${player?esc(player.username)+' · '+tr(linked?'已绑定管理员，可选择密码或通行密钥验证。':'此玩家尚未绑定管理员账号，请切换到已绑定账号。',linked?'Linked administrator: verify with a password or passkey.':'This citizen has no linked administrator. Switch to a linked account.'):tr('先登录已绑定管理员的玩家账号，再验证管理员身份。','Sign in to a linked citizen account, then verify administrator access.')}</p><div class="actions">${linked?`<button id="admin-enter" class="primary">${tr('使用管理员密码','Use admin password')}</button><button id="admin-passkey">${tr('使用通行密钥','Use passkey')}</button>`:`<button id="admin-player-login" class="primary">${tr('登录绑定玩家账号','Sign in to linked citizen')}</button>`}</div></div>`;
    $('#admin-player-login',el)?.addEventListener('click',async()=>{await login(false,'player',{hideRegistration:true});await session();renderAccount();render(el);});
    $('#admin-passkey',el)?.addEventListener('click',e=>action(e.currentTarget,async()=>{await passkeyLogin('admin');await session();renderAccount();render(el);}));
    $('#admin-enter',el)?.addEventListener('click',()=>modal(tr('管理密码验证','Verify admin password'),field('admin_password',tr('管理密码','Admin password'),'password'),{label:tr('验证并进入','Verify and enter'),submit:async d=>{await post('/api/init?action=admin-enter-password',d);await session();renderAccount();render(el);}}));
    return;
  }
  el.innerHTML=title('市政管理后台','City administration')+`<div class="section-head"><span>👤 ${esc(state.session.user.username)} <span class="badge">${esc(state.session.user.role.toUpperCase())}</span></span><button id="refresh-stats">↻ ${tr('刷新概览','Refresh overview')}</button></div><div id="admin-stats"></div><div class="admin-layout" style="margin-top:28px"><nav class="admin-nav" aria-label="${tr('管理功能','Administration')}">${navigationFor(isSuper()).map(group=>`<button data-group="${group.id}" aria-selected="false">${tr(...group.label)}</button>`).join('')}</nav><section id="admin-section" class="admin-content"><section id="admin-view"></section></section></div>`;
  view=$('#admin-view',el);
  $$('[data-group]',el).forEach(b=>b.onclick=()=>switchTab(b.dataset.group));
  $('#refresh-stats',el).onclick=refreshStats;
  refreshStats();
  let key=location.hash.slice(1);

  switchTab(key||'tickets');
}
