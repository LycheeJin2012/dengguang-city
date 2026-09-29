import {post} from './core.js'
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)).buffer;
const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function passkeyLogin(target='player'){
  if(!navigator.credentials||!window.PublicKeyCredential)throw new Error('这个浏览器还不认通行密钥，换个浏览器或用账号密码进来');
  const d=await post('/api/init?action='+ (target==='admin'?'passkey-admin-start':'passkey-login-start'));
  const opts=d.publicKey;
  opts.challenge=decode(opts.challenge);
  if(opts.allowCredentials)opts.allowCredentials=opts.allowCredentials.map(c=>({
    ...c,id:decode(c.id)
  }
  ));
  const cred=await navigator.credentials.get({
    publicKey:opts
  }
  );
  if(!cred)throw new Error('没验完就退出了，重来一次');
  await post('/api/init?action='+(target==='admin'?'passkey-admin-finish':'passkey-login-finish'),{
    challenge_token:d.challenge_token,target,credential:{
      id:cred.id,rawId:encode(cred.rawId),type:cred.type,response:{
        clientDataJSON:encode(cred.response.clientDataJSON),authenticatorData:encode(cred.response.authenticatorData),signature:encode(cred.response.signature),userHandle:cred.response.userHandle?encode(cred.response.userHandle):null
      }
    }
  }
  );
}
export async function registerPasskey(name){
  if(!navigator.credentials||!window.PublicKeyCredential)throw new Error('这个浏览器还不认通行密钥，换个浏览器或用账号密码进来');
  const d=await post('/api/init?action=passkey-register-start');
  const opts=d.publicKey;
  opts.challenge=decode(opts.challenge);
  opts.user.id=decode(opts.user.id);
  if(opts.excludeCredentials)opts.excludeCredentials=opts.excludeCredentials.map(c=>({
    ...c,id:decode(c.id)
  }
  ));
  const cred=await navigator.credentials.create({
    publicKey:opts
  }
  );
  if(!cred)throw new Error('没验完就退出了，重来一次');
  await post('/api/init?action=passkey-register-finish',{
    name,challenge_token:d.challenge_token,credential:{
      id:cred.id,rawId:encode(cred.rawId),type:cred.type,response:{
        clientDataJSON:encode(cred.response.clientDataJSON),attestationObject:encode(cred.response.attestationObject),transports:cred.response.getTransports?.()||[]
      }
    }
  }
  );
}

export async function testPasskey(id){
 if(!navigator.credentials||!window.PublicKeyCredential)throw new Error('这个浏览器还不认通行密钥，换个浏览器或用账号密码进来');
 const d=await post('/api/init?action=passkey-test-start',{id});const opts=d.publicKey;opts.challenge=decode(opts.challenge);opts.allowCredentials=opts.allowCredentials.map(c=>({...c,id:decode(c.id)}));
 let cred;try{cred=await navigator.credentials.get({publicKey:opts});}catch(e){if(e.name==='NotAllowedError')throw new Error('你取消了，或者等超时了，再点一次就行');throw e;}
 if(!cred)throw new Error('设备没验成，重来一次');
 return post('/api/init?action=passkey-test-finish',{challenge_token:d.challenge_token,credential:{id:cred.id,rawId:encode(cred.rawId),type:cred.type,response:{clientDataJSON:encode(cred.response.clientDataJSON),authenticatorData:encode(cred.response.authenticatorData),signature:encode(cred.response.signature)}}});
}
