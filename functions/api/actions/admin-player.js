import {players} from '../../_core/accounts.js';
export const onRequestPost=c=>{const list=new URL(c.request.url).searchParams.get('action')==='admin-player-list';return players(list?{...c,request:new Request(c.request.url,{headers:c.request.headers})}:c);};
