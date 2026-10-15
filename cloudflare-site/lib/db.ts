import {env} from 'cloudflare:workers';
export function runtime(){return env as unknown as {DB:D1Database;BUCKET:R2Bucket;ADMIN_EMAIL?:string;ADMIN_SUBJECT?:string;EMAIL_API_KEY?:string;EMAIL_FROM?:string;SITE_URL?:string;SUPABASE_URL?:string;SUPABASE_PUBLISHABLE_KEY?:string};}
export function database(){const d=runtime().DB;if(!d)throw new Error('Database unavailable');return d;}
export async function rows(sql:string,...values:any[]){return (await database().prepare(sql).bind(...values).all()).results as any[];}
export async function one(sql:string,...values:any[]){return await database().prepare(sql).bind(...values).first() as any;}
export async function run(sql:string,...values:any[]){return database().prepare(sql).bind(...values).run();}
export async function batch(statements:{sql:string;values:any[]}[]){return database().batch(statements.map(s=>database().prepare(s.sql).bind(...s.values)));}
export function id(){return crypto.randomUUID();}export function now(){return new Date().toISOString();}
export function unpack(r:any){return {...r,data:r.data?JSON.parse(r.data):undefined,profile:r.profile?JSON.parse(r.profile):undefined,snapshot:r.snapshot?JSON.parse(r.snapshot):undefined,details:r.details?JSON.parse(r.details):undefined};}
