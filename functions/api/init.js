// Compatibility action router. All database setup is handled by the API middleware.
import {
  endpoint,identity,reply,fail
}
from '../_core/request.js';
import * as signin from './actions/signin.js';
import * as account from './actions/account.js';
import * as passkey from './actions/passkey.js';
import * as adminPlayer from './actions/admin-player.js';
import * as adminDm from './actions/admin-dm.js';
import {
  onRequestGet as bundle
}
from './homepage-bundle.js';
import {
  resource
}
from '../_core/resources.js';
const manage={
  'hotels-manage':'hotels','hotel-rooms-manage':'hotel-rooms','race-tracks-manage':'race-tracks','license-req-manage':'license-req'
}
;
export const onRequestGet=c=>endpoint(async()=>{
  const action=new URL(c.request.url).searchParams.get('action');if(action==='signin-status')return signin.onRequestGet(c);if(action==='homepage-bundle'){
    const r=await bundle(c),d=await r.json();d.bundle.hotels=d.bundle.hotels.filter(h=>h.is_active);d.bundle.rooms=d.bundle.rooms.filter(r=>r.is_active);return reply({
      bundle:d.bundle
    }
    );
  }
  if(manage[action])return resource(manage[action])(c);if(action==='players-list'){
    await identity(c,'admin');const rows=await c.env.DB.prepare('SELECT id,username,email,status,emeralds,created_at FROM players ORDER BY id DESC LIMIT 500').all();return reply({
      items:rows.results
    }
    );
  }
  if(action==='unread-summary'){
    let p;try{
      p=await identity(c);
    }
    catch(e){
      if(e.status===401)return reply({
        logged_in:false,dm:0,msg_replies:0,announcement:null
      }
      );throw e;
    }
    const dm=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM direct_messages WHERE to_player_id=? AND read_at IS NULL').bind(p.id).first();const n=await c.env.DB.prepare('SELECT COUNT(*) AS n FROM notification_log WHERE player_id=? AND read_at IS NULL').bind(p.id).first();return reply({
      logged_in:true,dm:dm.n,msg_replies:n.n,announcement:null
    }
    );
  }
  if(!action){
    await identity(c,'super');return reply({
      schema_version:51
    }
    );
  }
  fail(404,'未知功能');
}
);
export const onRequestPost=c=>endpoint(async()=>{
  const u=new URL(c.request.url),a=u.searchParams.get('action')||'';if(['signin','signin-status'].includes(a))return signin.onRequestPost(c);if(a.startsWith('passkey-'))return passkey.onRequestPost(c);if(a.startsWith('admin-dm-'))return adminDm.onRequestPost(c);if(a.startsWith('admin-player-'))return adminPlayer.onRequestPost(c);if(['admin-logout','admin-merge-account','admin-unmerge-account','admin-reset-player-password','admin-enter-password','player-change-password'].includes(a))return account.onRequestPost(c);if(a.startsWith('announcement-')){
    const method={
      'announcement-create':'POST','announcement-update':'PATCH','announcement-delete':'DELETE'
    }
    [a];if(!method)fail(404,'未知公告操作');const request=new Request(c.request,{
      method,body:method==='DELETE'?null:await c.request.text()
    }
    );return resource('announcements')({
      ...c,request
    }
    );
  }
  fail(404,'未知功能');
}
);
