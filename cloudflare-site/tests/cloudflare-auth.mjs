import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const baseRequire=createRequire(import.meta.url),require=createRequire(baseRequire.resolve('wrangler/package.json'));
const {Miniflare}=require('miniflare');
const fixtures=new Map(),tokens=new Map(),requests=[];
const candidateId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',ownerId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
let latestId=candidateId,checks=0;
function user(uid,email,confirmed=true){return {id:uid,aud:'authenticated',role:'authenticated',email,email_confirmed_at:confirmed?new Date().toISOString():null,created_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[{identity_id:uid,id:uid,user_id:uid,provider:'email',identity_data:{email}}]}}
function session(u){const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:u.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})).toString('base64url'),'fixture-signature'].join('.');tokens.set(token,u);return {access_token:token,refresh_token:`refresh-${u.id}`,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:u}}
const mf=new Miniflare({modules:[{type:'ESModule',path:resolve('dist/server/index.js')},...readdirSync('dist/server',{recursive:true}).filter(p=>/\.m?js$/.test(p)&&p!=='index.js').map(p=>({type:'ESModule',path:resolve('dist/server',p)}))],modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{ADMIN_EMAIL:'owner@example.test',ADMIN_SUBJECT:`supabase:${ownerId}`,SITE_URL:'https://apex.test',SUPABASE_URL:'https://auth.apex.test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'},assets:{directory:resolve('dist/client'),routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},outboundService:async req=>{
 const url=new URL(req.url);if(url.origin!=='https://auth.apex.test')throw new Error('Unexpected outbound service');requests.push({path:url.pathname,method:req.method});const d=req.method==='GET'?{}:await req.json().catch(()=>({}));const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');const u=tokens.get(token);const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json'}});
 if(url.pathname.endsWith('/signup')){const unverified=user(latestId,d.email,false);fixtures.set(latestId,user(latestId,d.email));return json(unverified)}
 if(url.pathname.endsWith('/token')){if(url.searchParams.get('grant_type')==='password'){const found=[...fixtures.values()].find(u=>u.email===d.email);if(!found||d.password!=='ValidPassword123')return json({msg:'Invalid login credentials',error_code:'invalid_credentials'},400);return json(session(found))}if(url.searchParams.get('grant_type')==='pkce'){if(d.auth_code!=='valid-code')return json({msg:'Invalid code'},400);return json(session(fixtures.get(latestId)))}if(url.searchParams.get('grant_type')==='refresh_token')return json(session(fixtures.get(d.refresh_token.replace('refresh-',''))))}
 if(url.pathname.endsWith('/user'))return u?json(u):json({msg:'Invalid token'},401);
 if(url.pathname.endsWith('/recover')||url.pathname.endsWith('/resend')||url.pathname.endsWith('/logout'))return json({});
 return json({error:'Unexpected auth route'},404);
}});
let jar=new Map();
async function call(path,method='GET',data,expected=200,platform=false,origin='https://apex.test'){
 const headers={cookie:Array.from(jar,([k,v])=>`${k}=${v}`).join('; ')};if(method!=='GET'){headers.origin=origin;headers['content-type']='application/json'}if(platform){headers['oai-authenticated-user-id']='qa-owner';headers['oai-authenticated-user-email']='owner@example.test'}
 const r=await mf.dispatchFetch(`https://apex.test/api/${path}`,{method,headers,...(method==='GET'?{}:{body:JSON.stringify(data||{})})});const content=await r.text();assert.equal(r.status,expected,`${path}: ${content.slice(0,250)}`);checks++;
 const cookieHeaders=r.headers.getSetCookie();for(const c of cookieHeaders){assert.match(c,/HttpOnly/i);assert.match(c,/SameSite=Lax/i);assert.match(c,/Secure/i);checks++;const [kv]=c.split(';'),i=kv.indexOf('=');const k=kv.slice(0,i),v=kv.slice(i+1);if(/Max-Age=0/i.test(c)||!v)jar.delete(k);else jar.set(k,v)}
 return {body:JSON.parse(content),cookieHeaders};
}
try{
 const db=await mf.getD1Database('DB');for(const migration of readdirSync('drizzle').filter(p=>p.endsWith('.sql')).sort())for(const stmt of readFileSync(`drizzle/${migration}`,'utf8').replaceAll('--> statement-breakpoint','').split(';').filter(s=>s.trim()))await db.prepare(stmt).run();
 const s=await call('session');assert.equal(s.body.emailAuthConfigured,true);checks++;
 await call('auth/signup','POST',{email:'bad',password:'short'},400);
 await call('auth/signup','POST',{email:'candidate@example.test',name:'Email candidate',phone:'+201000000001',role:'admin',password:'ValidPassword123',consent:true},400);
 const signup={email:'candidate@example.test',name:'Email candidate',phone:'+201000000001',role:'candidate',password:'ValidPassword123',consent:true};
 await call('auth/signup','POST',signup,403,false,'https://attacker.test');
 const registration=await call('auth/signup','POST',signup);assert.equal(registration.body.confirmationRequired,true);checks++;assert.ok(jar.size,'PKCE verifier stored');checks++;
 const raw=await db.prepare("SELECT data FROM records WHERE kind='registration'").first();assert.ok(!raw.data.includes('ValidPassword123'),'Password never stored in D1');checks++;
 await call('dashboard','GET',undefined,401);
 await call('auth/exchange','POST',{code:'invalid'},400);
 await call('auth/exchange','POST',{code:'valid-code'});
 const profile=await call('session');assert.equal(profile.body.authProvider,'Email');assert.equal(profile.body.user.name,'Email candidate');assert.equal(profile.body.user.profile.phone,signup.phone);assert.equal(profile.body.user.role,'candidate');checks+=4;
 await call('profile','PUT',{name:'Updated candidate',phone:signup.phone,location:'Alexandria'});
 await call('content','PUT',{headline:'Forbidden'},403);
 await call('auth/password','POST',{password:'short'},400);await call('auth/password','POST',{password:'NewPassword123'});
 await call('auth/reset','POST',{email:signup.email});await call('auth/resend','POST',{email:signup.email});
 await db.prepare("DELETE FROM rates WHERE key LIKE 'email-auth:%'").run();
 await call('auth/signout','POST',{});assert.equal((await call('session')).body.authenticated,false);checks++;
 await call('auth/signin','POST',{email:signup.email,password:'incorrect'},401);
 await call('auth/signin','POST',{email:signup.email,password:'ValidPassword123'});assert.equal((await call('session')).body.user.name,'Updated candidate');checks++;
 await call('auth/signout','POST',{});
 // Forged platform headers cannot authenticate on an independent Worker.
 assert.equal((await call('session','GET',undefined,200,true)).body.authenticated,false);checks++;
 latestId=ownerId;fixtures.set(ownerId,user(ownerId,'owner@example.test'));
 await call('auth/signin','POST',{email:'owner@example.test',password:'ValidPassword123'});
 const owner=await call('session');assert.equal(owner.body.user.role,'admin');checks++;
 await call('content','PUT',{headline:'Verified owner update'});
 await call('auth/signout','POST',{});
 await db.prepare("INSERT INTO users (id,email,name,role,profile,created) VALUES ('old-platform-id','legacy@example.test','Legacy owner','admin','{}',?)").bind(new Date().toISOString()).run();
 latestId='cccccccc-cccc-4ccc-cccc-cccccccccccc';fixtures.set(latestId,user(latestId,'legacy@example.test'));
 await call('auth/signin','POST',{email:'legacy@example.test',password:'ValidPassword123'},409);
 assert.equal((await call('session')).body.authenticated,false);checks++;
 jar=new Map([['sb-auth-auth-token','tampered']]);assert.equal((await call('session')).body.authenticated,false);checks++;
 assert.ok(requests.some(r=>r.path.endsWith('/user')));checks++;
 console.log(JSON.stringify({passed:true,checks,note:'Isolated D1/R2 and mocked Supabase: verified sessions, cookies, PKCE, owner subject, roles, forged headers and legacy-account takeover prevention. No production changes.'}));
}finally{await mf.dispose()}
