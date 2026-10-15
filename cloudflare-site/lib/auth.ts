import {createServerClient,parseCookieHeader,serializeCookieHeader} from '@supabase/ssr';
import {getChatGPTUser,type ChatGPTUser} from '@/app/chatgpt-auth';
import {batch,one,runtime,now,id} from '@/lib/db';

export type ApexIdentity=ChatGPTUser & {provider:'ChatGPT'|'Email'};
export function emailAuthConfigured(){const e=runtime();return !!(e.SUPABASE_URL&&e.SUPABASE_PUBLISHABLE_KEY)}
export function authContext(req:Request){
 const e=runtime(),pending:string[]=[],jar=new Map(parseCookieHeader(req.headers.get('cookie')||'').map(c=>[c.name,c.value]));
 const client=emailAuthConfigured()?createServerClient(e.SUPABASE_URL!,e.SUPABASE_PUBLISHABLE_KEY!,{
  cookieOptions:{path:'/',httpOnly:true,sameSite:'lax',secure:new URL(req.url).protocol==='https:'},
  cookies:{getAll:()=>Array.from(jar,([name,value])=>({name,value})),setAll:values=>{for(const {name,value,options} of values){jar.set(name,value);pending.push(serializeCookieHeader(name,value,{...options,path:'/',httpOnly:true,sameSite:'lax',secure:new URL(req.url).protocol==='https:'}))}}},
  auth:{flowType:'pkce',autoRefreshToken:false,detectSessionInUrl:false},
 }):null;
 return {client,hasSession:()=>Array.from(jar.keys()).some(k=>k.startsWith('sb-')&&k.includes('auth-token')&&!k.endsWith('code-verifier')),
  finish:(response:Response)=>{for(const cookie of pending)response.headers.append('Set-Cookie',cookie);return response}};
}
export type AuthContext=ReturnType<typeof authContext>;
export async function getApexIdentity(context:AuthContext):Promise<ApexIdentity|null>{
 const platform=await getChatGPTUser();
 if(context.client&&context.hasSession()){
  const {data:{user},error}=await context.client.auth.getUser();
  if(!error&&user?.email&&user.email_confirmed_at){
   const subject=`supabase:${user.id}`,address=user.email.toLowerCase();
   const alias=await one('SELECT user_id FROM auth_identities WHERE subject=?',subject);
   let userId=alias?.user_id||subject;
   const existing=await one('SELECT id FROM users WHERE lower(email)=?',address);
   if(!alias&&existing&&platform&&platform.userId===existing.id&&platform.email.toLowerCase()===address){
    await batch([{sql:'INSERT OR IGNORE INTO auth_identities (subject,user_id,created) VALUES (?,?,?)',values:[subject,existing.id,now()]},{sql:"DELETE FROM records WHERE kind='registration' AND owner=?",values:[subject]}]);userId=existing.id;
   }else if(!alias&&!existing){
    const registration=await one("SELECT * FROM records WHERE kind='registration' AND owner=? AND status='Pending'",subject);
    if(registration){const d=JSON.parse(registration.data);if(d.expires>Date.now()&&['client','candidate'].includes(d.role)&&d.consent===true){
     const n=now();await batch([
      {sql:'INSERT OR IGNORE INTO users (id,email,name,role,profile,created) VALUES (?,?,?,?,?,?)',values:[subject,address,d.name,d.role,JSON.stringify({phone:d.phone,company:d.company||'',consentAt:n,marketingConsent:d.marketingConsent===true}),n]},
      {sql:'INSERT OR IGNORE INTO auth_identities (subject,user_id,created) VALUES (?,?,?)',values:[subject,subject,n]},
      {sql:"DELETE FROM records WHERE kind='registration' AND owner=?",values:[subject]},
      {sql:'INSERT INTO audit (id,actor,action,target,created) VALUES (?,?,?,?,?)',values:[id(),subject,'account_registered',subject,n]},
     ]);
    }}
   }
   return {userId,email:address,displayName:address,fullName:null,provider:'Email'};
  }
 }
 return platform?{...platform,provider:'ChatGPT'}:null;
}
