import {$,$$,api,post,del,tr,esc,toast} from './core.js';
import {CHUNK_SIZE,MEDIA_TYPES,MAX_ATTACHMENTS,MAX_TICKET_BYTES,fileLimit,inferType} from '../../shared/uploads.js';
export const sizeLabel=n=>n<1024*1024?Math.ceil(n/1024)+' KB':(n/1024/1024).toFixed(1)+' MB';
function toBase64(buffer){const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary);}
export async function uploadFile(file,{purpose='ticket',progress=()=>{},signal,resumeId,onCreated=()=>{}}={}){
 const mime=inferType(file);if(!MEDIA_TYPES.includes(mime)||purpose==='public-image'&&!mime.startsWith('image/'))throw new Error(tr('请选择支持的图片或视频','Choose a supported image or video'));
 if(file.size<1||file.size>fileLimit(mime))throw new Error(tr('图片最大 20 MB，视频最大 100 MB','Images: 20 MB maximum; videos: 100 MB'));
 let id=resumeId,parts=[];
 if(id){const metadata=await api('/api/uploads?id='+id,{signal});parts=metadata.parts;if(metadata.status==='ready'){progress(100);return metadata;}}
 else {const created=await api('/api/uploads',{method:'POST',body:{name:file.name,mime,size:file.size,purpose},signal});id=created.id;onCreated(id);}
 const uploaded=new Set(parts),total=Math.ceil(file.size/CHUNK_SIZE);
 for(let part=0;part<total;part++){
  if(signal?.aborted)throw new Error(tr('已取消上传','Upload cancelled'));
  if(!uploaded.has(part)){
   const data=toBase64(await file.slice(part*CHUNK_SIZE,Math.min(file.size,(part+1)*CHUNK_SIZE)).arrayBuffer());
   let failure;
   for(let attempt=0;attempt<3;attempt++){
    try{await api(`/api/uploads?id=${id}&part=${part}`,{method:'PUT',body:{data},signal});failure=null;break;}
    catch(error){failure=error;if(signal?.aborted||error.status&&error.status<500)break;}
   }
   if(failure)throw failure;
  }
  progress(Math.round((part+1)/total*100));
 }
 const result=await api('/api/uploads',{method:'POST',body:{action:'finish',id},signal});progress(100);return result;
}
export function attachmentPicker(dialog,{purpose='ticket',max=MAX_ATTACHMENTS,existingBytes=0}={}){
 const items=[];let closed=false;const box=document.createElement('section');box.className='attachment-picker wide';
 box.innerHTML=`<div class="upload-drop" tabindex="0" role="button" aria-label="${tr('选择附件','Choose attachments')}"><strong>＋ ${tr(purpose==='public-image'?'选择图片':'添加图片或视频',purpose==='public-image'?'Choose image':'Add images or videos')}</strong><span>${tr(purpose==='public-image'?'支持拖放，图片最大 20 MB':`可拖放或粘贴 · 图片 20 MB / 视频 100 MB · 最多 ${max} 个，合计 200 MB`,purpose==='public-image'?'Drop an image here. Maximum 20 MB':`Drop or paste · Images 20 MB / videos 100 MB · Up to ${max} files, 200 MB total`)}</span><input type="file" hidden ${max>1?'multiple':''} accept="${MEDIA_TYPES.filter(t=>purpose!=='public-image'||t.startsWith('image/')).join(',')}"></div><div class="upload-list" aria-live="polite"></div>`;
 $('.form-grid',dialog).append(box);const input=$('input',box),drop=$('.upload-drop',box),list=$('.upload-list',box);
 function draw(){const submit=$('button[type=submit]',dialog);if(submit){submit.disabled=dialog.dataset.saving==='true'||items.some(item=>!item.ready);submit.title=items.some(item=>!item.ready)?tr('请等待附件上传完成','Wait for attachments to finish uploading'):'';}list.innerHTML=items.map((item,index)=>`<div class="upload-row" data-index="${index}"><div class="upload-preview">${item.mime.startsWith('image/')?`<img src="${esc(item.preview)}" alt="">`:`<video src="${esc(item.preview)}" preload="metadata" muted></video>`}</div><div class="upload-info"><b>${esc(item.file.name)}</b><small>${sizeLabel(item.file.size)} · ${esc(item.error||tr(item.ready?'已上传':item.pending?'上传中…':'等待上传',item.ready?'Uploaded':item.pending?'Uploading…':'Waiting'))}</small><progress max="100" value="${item.percent}">${item.percent}%</progress></div><div class="upload-actions">${item.error?`<button type="button" data-retry="${index}">${tr('重试','Retry')}</button>`:''}<button type="button" data-remove="${index}">${tr('移除','Remove')}</button></div></div>`).join('');
 $$('[data-retry]',list).forEach(b=>b.onclick=()=>start(items[+b.dataset.retry]));$$('[data-remove]',list).forEach(b=>b.onclick=()=>{const item=items[+b.dataset.remove];item.removed=true;item.controller?.abort();if(item.id)del('/api/uploads?id='+item.id).catch(()=>{});URL.revokeObjectURL(item.preview);items.splice(+b.dataset.remove,1);draw();});
 }
 async function start(item){if(item.pending)return;item.error='';item.pending=true;item.controller=new AbortController();draw();try{item.upload=await uploadFile(item.file,{purpose,signal:item.controller.signal,resumeId:item.id,onCreated:id=>item.id=id,progress:n=>{item.percent=n;if(!closed){const index=items.indexOf(item),bar=$('[data-index="'+index+'"] progress',list);if(bar){bar.value=n;bar.textContent=n+'%';}}}});item.ready=true;}catch(e){if(!item.removed)item.error=e.message;}finally{item.pending=false;if(item.removed&&item.id)del('/api/uploads?id='+item.id).catch(()=>{});if(!closed)draw();}}
 function add(files){for(const file of files){if(items.length>=max){toast(tr(`最多选择 ${max} 个文件`,`Choose up to ${max} files`),true);break;}if(existingBytes+items.reduce((sum,item)=>sum+item.file.size,0)+file.size>MAX_TICKET_BYTES){toast(tr('附件合计不能超过 200 MB','Attachments cannot exceed 200 MB in total'),true);continue;}const mime=inferType(file);if(!mime||purpose==='public-image'&&!mime.startsWith('image/')||file.size>fileLimit(mime)||!file.size){toast(tr('文件类型不支持或超过大小限制','Unsupported file or size limit exceeded'),true);continue;}const item={file,mime,preview:URL.createObjectURL(file),percent:0,pending:false};items.push(item);start(item);}input.value='';draw();}
 drop.onclick=event=>{if(event.target!==input)input.click();};drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}};input.onchange=()=>add(input.files);
 drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragging');};drop.ondragleave=()=>drop.classList.remove('dragging');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragging');add(e.dataTransfer.files);};
 dialog.addEventListener('paste',event=>{const files=[...(event.clipboardData?.files||[])];if(files.length){event.preventDefault();add(files);}});
 dialog.addEventListener('close',()=>{closed=true;for(const item of items){item.controller?.abort();URL.revokeObjectURL(item.preview);if(item.id&&!item.committed)del('/api/uploads?id='+item.id).catch(()=>{});}});
 return {files(){if(items.some(i=>!i.ready))throw new Error(tr('请等待附件上传完成，或重试/移除失败文件','Wait for uploads to finish, or retry/remove failed files'));return items.map(i=>i.upload);},ids(){return this.files().map(f=>f.id);},commit(){items.forEach(i=>i.committed=true);},element:box};
}
export function renderAttachments(files=[]){return files.length?`<section class="attachment-gallery"><h3>${tr('附件材料','Attachments')} (${files.length})</h3><div class="attachment-grid">${files.map(f=>`<article class="attachment-card">${f.mime.startsWith('image/')?`<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy"></a>`:`<video controls preload="metadata" playsinline src="${esc(f.url)}"></video>`}<b>${esc(f.name)}</b><small>${sizeLabel(f.size)}</small><a href="${esc(f.url)}&save=1">${tr('下载原文件','Download original')}</a></article>`).join('')}</div><small>${tr('若浏览器无法预览图片或播放视频，可下载原文件查看。','If your browser cannot preview this image or video, download the original file.')}</small></section>`:'';}
