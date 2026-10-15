import {z} from 'zod';
import {authContext,getApexIdentity} from '@/lib/auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {one,run,id,now,runtime} from '@/lib/db';
export const dynamic='force-dynamic';
const password=z.string().min(10).max(128);
const address=z.string().trim().email().max(254).transform(v=>v.toLowerCase());
function json(data:any,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
async function throttle(req:Request){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(req.headers.get('cf-connecting-ip')||'anonymous'));const ip=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join(''),minute=Math.floor(Date.now()/60000),key=`email-auth:${ip}:${minute}`;await run('INSERT INTO rates (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,minute+3);const r=await one('SELECT count FROM rates WHERE key=?',key);return r.count<=10}
export async function POST(req:Request){const context=authContext(req),client=context.client;const finish=(r:Response)=>context.finish(r);
 try{
  const url=new URL(req.url),action=url.pathname.split('/').at(-1);
  if(req.headers.get('origin')!==url.origin)return finish(json({error:'Please submit from this website.'},403));
  if(!client)return finish(json({error:'Email sign-in is awaiting account-service configuration.'},503));
  if(Number(req.headers.get('content-length')||0)>12000)return finish(json({error:'Please shorten your details.'},413));
  if(!await throttle(req))return finish(json({error:'Too many attempts. Please try again shortly.'},429));
  const d:any=z.record(z.unknown()).parse(await req.json());if(JSON.stringify(d).length>12000)return finish(json({error:'Please shorten your details.'},413));const configured=runtime().SITE_URL;
  if(!configured)return finish(json({error:'Email sign-in is awaiting website configuration.'},503));
  const origin=new URL(configured).origin;
  const next=d.next==='proposal'?'&next=proposal':'';const role=d.role==='client'?'client':'candidate';
  const redirect=`${origin}/account?auth=confirmed&role=${role}${next}`;
  if(action==='signup'){
   const values=z.object({email:address,password,name:z.string().trim().min(1).max(200),phone:z.string().trim().min(6).max(40),role:z.enum(['client','candidate']),company:z.string().trim().max(200).optional(),consent:z.literal(true),marketingConsent:z.boolean().optional()}).parse(d);
   if(values.role==='client'&&!values.company)return finish(json({error:'Company name is required.'},400));
   const platform=await getChatGPTUser(),existing=await one('SELECT id FROM users WHERE lower(email)=?',values.email);
   if(existing&&platform?.userId!==existing.id)return finish(json({error:'This email already has an Apex profile. Contact Apex to link email sign-in to your existing profile.'},409));
   if(platform&&existing&&platform.email.toLowerCase()!==values.email)return finish(json({error:'Use the email address associated with your current Apex profile.'},400));
   const {data,error}=await client.auth.signUp({email:values.email,password:values.password,options:{emailRedirectTo:redirect}});
   if(error)return finish(json({error:error.code==='email_address_not_authorized'?'Email delivery is awaiting company setup. Please contact Apex.':error.message},400));
   if(data.user?.identities?.length){const subject=`supabase:${data.user.id}`,n=now();await run("DELETE FROM records WHERE kind='registration' AND json_extract(data,'$.expires')<?",Date.now());await run('INSERT INTO records (id,kind,owner,status,data,created,updated) VALUES (?,?,?,?,?,?,?)',id(),'registration',subject,'Pending',JSON.stringify({...values,password:undefined,expires:Date.now()+7*86400000}),n,n)}
   await getApexIdentity(context);return finish(json({confirmationRequired:!data.session,message:'Check your email to confirm your account.'}));
  }
  if(action==='signin'){
   const values=z.object({email:address,password:z.string().min(1).max(128)}).parse(d);const {error}=await client.auth.signInWithPassword(values);
   if(error)return finish(json({error:error.code==='email_not_confirmed'?'Confirm your email before signing in.':'Email or password is incorrect.'},401));
   const identity=await getApexIdentity(context);if(!identity||identity.provider!=='Email')return finish(json({error:'Confirm your email before signing in.'},401));
   const u=await one('SELECT * FROM users WHERE id=?',identity.userId);const existing=await one('SELECT id FROM users WHERE lower(email)=?',identity.email);
   if(existing&&!u){await client.auth.signOut({scope:'local'});return finish(json({error:'Contact Apex to link email sign-in to your existing profile.'},409))}
   if(u?.deleted){await client.auth.signOut({scope:'local'});return finish(json({error:'This Apex profile has been deleted. Contact Apex for help.'},403))}
   return finish(json({signedIn:true,registered:!!u}));
  }
  if(action==='exchange'){
   const code=z.string().min(1).max(3000).parse(d.code);const {error}=await client.auth.exchangeCodeForSession(code);
   if(error)return finish(json({error:'This link has expired or was opened in another browser. Request a new link and open it in the browser you used to register.'},400));
   await getApexIdentity(context);return finish(json({signedIn:true}));
  }
  if(action==='reset'){
   const email=address.parse(d.email);const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:`${origin}/account?auth=recovery`});
   if(error)return finish(json({error:'The reset email could not be sent. Please try again later or contact Apex.'},400));
   return finish(json({message:'If an account exists for this email, a password-reset link has been sent.'}));
  }
  if(action==='password'){
   const identity=await getApexIdentity(context);if(identity?.provider!=='Email')return finish(json({error:'Open your password-reset link or sign in with email first.'},401));
   const {error}=await client.auth.updateUser({password:password.parse(d.password)});if(error)return finish(json({error:error.message},400));return finish(json({saved:true}));
  }
  if(action==='resend'){
   const email=address.parse(d.email);const {error}=await client.auth.resend({type:'signup',email,options:{emailRedirectTo:redirect}});if(error)return finish(json({error:'The confirmation email could not be sent. Please try again later.'},400));return finish(json({sent:true}));
  }
  if(action==='signout'){const {error}=await client.auth.signOut({scope:'local'});if(error)return finish(json({error:'Sign-out could not complete. Please try again.'},503));return finish(json({signedOut:true}))}
  return finish(json({error:'This action is unavailable.'},404));
 }catch(error){if(error instanceof z.ZodError)return finish(json({error:'Check your email, name and phone. Use a password with at least 10 characters and accept the policies.'},400));return finish(json({error:'Email sign-in is temporarily unavailable. Please try again.'},503))}
}
