import {
  $, $$, api, post, patch, del, tr, esc, text, ticketBody, date, status, empty, title, field, modal, region, action, toast, state, session, login, csv
}
from './core.js';
import {
  passkeyLogin,registerPasskey
}
from './security.js';
const names={
  questions:['📚 模拟题库','📚 Question bank'],tickets:['🎫 工单中心','🎫 Tickets'],players:['👥 玩家管理','👥 Citizens'],bookings:['🏨 酒店预订','🏨 Bookings'],kart:['🛞 卡丁车报名','🛞 Kart signups'],circuit:['🏁 国际试车','🏁 Circuit signups'],license:['🚗 驾照报名','🚗 License applications'],tracks:['🏎️ 赛车场管理','🏎️ Tracks'],hotels:['🏡 酒店管理','🏡 Hotels'],rooms:['🛏️ 房型管理','🛏️ Rooms'],requirements:['📝 考试要求','📝 Requirements'],announcements:['📜 公告管理','📜 Announcements'],gallery:['🖼️ 图集管理','🖼️ Gallery'],admins:['🛡️ 管理员','🛡️ Administrators'],dms:['✉️ 私信监管','✉️ DM moderation'],times:['🏆 成绩审核','🏆 Race verification'],password:['🔑 账号安全','🔑 Security']
}
;
const resources={
  tracks:{
    path:'race-tracks',key:'tracks',fields:[['name','名称'],['length_km','长度 km','number'],['laps','圈数','number'],['difficulty','难度'],['trial_price','试车价格 💎','number'],['description','介绍','textarea'],['image_url','图片 URL'],['sort_order','排序','number'],['is_active','开放','checkbox']]
  }
  ,hotels:{
    path:'hotels',key:'hotels',fields:[['name','酒店名'],['address','地址'],['description','介绍','textarea'],['image_url','图片 URL'],['sort_order','排序','number'],['is_active','开放','checkbox']]
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
const superOnly=new Set(['tracks','hotels','rooms','requirements','announcements','gallery','admins','dms']);
const isSuper=()=>state.session?.user?.role==='super';
async function refreshStats() {
  await region($('#admin-stats', root), () => api('/api/admin/dashboard'), (data, box) => {
    const racePending = data.kart && data.circuit ? data.kart.pending + data.circuit.pending : null;
    const stats = [
      ['players', data.players?.pending, '待审玩家', 'Pending citizens'],
      ['tickets', data.messages?.unread, '未读留言', 'Unread messages'],
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
  box.innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr>${columns.map(([k,l])=>`<th>${esc(l)}</th>`).join('')}${actions.length?`<th>${tr('操作','Actions')}</th>`:''}</tr></thead><tbody>${rows.map((r,i)=>`<tr>${columns.map(([k,l,format])=>`<td class="${['title','content','name','note','body'].includes(k)?'wrap':''}">${format?format(r[k],r):esc(r[k]??'—')}</td>`).join('')}${actions.length?`<td><div class="actions compact">${actions.filter(a=>!a.when||a.when(r)).map(a=>`<button type="button" data-row="${i}" data-action="${a.key}" class="${a.danger?'danger':''}">${esc(a.label)}</button>`).join('')}</div></td>`:''}</tr>`).join('')}</tbody></table></div>`:empty();
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
      required:['name','title','content','hotel_id','image_url'].includes(key)&&!(key==='image_url'&&active!=='gallery'),min:type==='number'?0:undefined,step:key==='length_km'?'0.01':undefined,options:key==='cat'?[['city',tr('城市','City')],['road',tr('道路','Roads')],['kart',tr('卡丁车','Kart')],['nature',tr('自然','Nature')],['announcement',tr('公告','Announcement')]]:[['B',tr('B 级','Grade B')],['A',tr('A 级','Grade A')],['S',tr('S 级','Grade S')],['written',tr('笔试','Written')],['road',tr('路考','Road test')],['upgrade',tr('升级考试','Upgrade')]]
    }
    )).join('');
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
    const dialog = modal(tr(item.id?'编辑记录':'新建记录',item.id?'Edit record':'New record'),fields,{
      submit:async d=>{
        await (item.id?patch('/api/admin/'+def.path+'?id='+item.id,d):post('/api/admin/'+def.path,d));toast(tr('保存成功','Saved'));await load();
      }
    }
    );
    if(def.fields.some(f=>f[0]==='image_url')){
      const upload=document.createElement('label');
      upload.className='field wide';
      upload.textContent=tr('或选择图片（最大 1 MB）','Or choose an image (max 1 MB)');
      const input=document.createElement('input');
      input.type='file';
      input.accept='image/png,image/jpeg,image/webp,image/gif';
      upload.append(input);
      $('.form-grid',dialog).append(upload);
      input.onchange=()=>{
        const f=input.files?.[0];
        if(!f)return;
        if(!/^image\/(png|jpeg|webp|gif)$/.test(f.type)||f.size>1024*1024){
          toast(tr('请选择 1 MB 以内的图片','Choose an image under 1 MB'),true);
          input.value='';
          return;
        }
        const reader=new FileReader();
        reader.onerror=()=>toast(tr('图片读取失败','Could not read image'),true);
        reader.onload=()=>{
          $('[name=image_url]',dialog).value=reader.result;
        }
        ;
        reader.readAsDataURL(f);
      }
      ;
    }
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
    attachExport(d.players);table(box,[['id','ID'],['username',tr('游戏 ID','Game ID')],['email',tr('邮箱','Email')],['emeralds','💎'],['status',tr('状态','Status'),status]],d.players,[{
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
  toolbar({
    options:['open','in_progress','resolved','closed'],extra:field('category',tr('分类','Category'),'select','',{
      required:false,options:[['',tr('全部分类','All categories')],['message','留言'],['hotel','酒店'],['license','驾照'],['race','赛车'],['kart','卡丁车'],['service','服务']]
    }
    )
  }
  );
  const load=()=>region($('#records',view),()=>api('/api/tickets?'+params()),(d,box)=>{
    attachExport(d.tickets);table(box,[['id','ID'],['title',tr('标题','Title')],['player_username',tr('市民','Citizen')],['category',tr('分类','Category')],['status',tr('状态','Status'),status]],d.tickets,[{
      key:'detail',label:tr('处理工单','Review ticket'),run:async r=>{
        const data=await api('/api/tickets?id='+r.id),t=data.ticket;const admins=await api('/api/admin/admins');const dialog=modal(tr('工单 #','Ticket #')+r.id,`<div class="wide notice"><b>${esc(t.title)}</b><div>${ticketBody(t.body)}</div></div>`+field('status',tr('状态','Status'),'select',t.status,{
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
        ),{
          wide:true,submit:async values=>{
            await patch('/api/tickets?id='+r.id,{
              ...values,assignee_id:values.assignee_id?Number(values.assignee_id):null
            }
            );

await load();refreshStats();
          }
        }
        );
          const draftButton=document.createElement('button');draftButton.type='button';draftButton.textContent=tr('生成回复建议','Suggest a reply');$('.actions',dialog).prepend(draftButton);
          draftButton.onclick=e=>action(e.currentTarget,async()=>{const r=await post('/api/admin/messages',{message:t.body||t.title});$('[name=admin_reply]',dialog).value=r.draft;toast(tr('请核对建议内容，再点击保存发送','Review the suggestion before saving and sending'));});
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
    ),{
      submit:async d=>{
        if(!d.new_password)delete d.new_password;await (r.id?patch('/api/admin/admins?id='+r.id,d):post('/api/admin/admins',d));await load();
      }
    }
    );
  }
  const load=()=>region($('#records',view),()=>api('/api/admin/admins'),(d,box)=>{
    attachExport(d.admins);table(box,[['id','ID'],['username',tr('账号','Username')],['role',tr('角色','Role')],['linked_player_username',tr('绑定市民','Linked citizen')]],d.admins,[{
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
        );modal(tr('私信监管','DM moderation'),`<div class="wide">${d.messages.map(m=>`<div class="row"><small>#${m.from_player_id} · ${date(m.created_at)}</small><p>${text(m.content)}</p></div>`).join('')}</div>`+field('content',tr('管理员回复','Admin reply'),'textarea'),{
          wide:true,submit:async v=>{
            await post('/api/init?action=admin-dm-reply',{
              from_player_id:r.to_player_id,to_player_id:r.from_player_id,content:v.content
            }
            );await load();
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
async function loadActive(){
  const page=active;
  try{
    if(resources[page])await resourceList(resources[page]);
    else if(['bookings','kart','circuit','license'].includes(page))await signups(page);
    else await ({
      tickets,players,admins,dms,times,questions,password
    }
    [page])();
  }
  catch(e){
    if(page===active)view.innerHTML=`<div class="empty error">${esc(e.message)}</div>`;
  }
}
function switchTab(key){
  if(!names[key])key='tickets';
  active=key;
  location.hash=key;
  $$('.admin-nav button',root).forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===key));
  const next=document.createElement('section');
  next.className='admin-content';
  next.id='admin-view';
  view?.replaceWith(next);
  view=next;
  loadActive();
}
export async function render(el){
  root=el;
  if(!state.session?.admin){
    el.innerHTML=title('市政管理后台','City administration')+`<div class="panel"><h2>${tr('验证管理员身份','Verify administrator identity')}</h2><p>${tr('使用管理员账号，或验证已绑定市民账号的管理员密码。','Sign in with an administrator account or verify your linked administrator password.')}</p><div class="actions"><button id="admin-login" class="primary">${tr('账号登录','Sign in')}</button><button id="admin-passkey">${tr('通行密钥','Passkey')}</button>${state.session?.player?.linked_admin_id?`<button id="admin-enter">${tr('验证管理密码','Verify admin password')}</button>`:''}</div></div>`;
    $('#admin-login',el).onclick=async()=>{
      await login(false,'admin');
      await session();
      if(state.session?.admin)render(el);
    }
    ;
    $('#admin-passkey',el).onclick=e=>action(e.currentTarget,async()=>{
      await passkeyLogin('admin');await session();render(el);
    }
    );
    $('#admin-enter',el)?.addEventListener('click',()=>modal(tr('管理密码验证','Verify admin password'),field('admin_password',tr('管理密码','Admin password'),'password'),{
      submit:async d=>{
        await post('/api/init?action=admin-enter-password',d);await session();render(el);
      }
    }
    ));
    return;
  }
  el.innerHTML=title('市政管理后台','City administration')+`<div class="section-head"><span>👤 ${esc(state.session.user.username)} <span class="badge">${esc(state.session.user.role.toUpperCase())}</span></span><button id="refresh-stats">↻ ${tr('刷新概览','Refresh overview')}</button></div><div id="admin-stats"></div><div class="admin-layout" style="margin-top:28px"><nav class="admin-nav" aria-label="${tr('管理功能','Administration')}">${Object.entries(names).filter(([key])=>isSuper()||!superOnly.has(key)).map(([key,labels])=>`<button data-tab="${key}" aria-selected="false">${tr(...labels)}</button>`).join('')}</nav><section id="admin-view" class="admin-content"></section></div>`;
  view=$('#admin-view',el);
  $$('[data-tab]',el).forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  $('#refresh-stats',el).onclick=refreshStats;
  refreshStats();
  let key=location.hash.slice(1);
  if(superOnly.has(key)&&!isSuper())key='tickets';
  switchTab(key||'tickets');
}
