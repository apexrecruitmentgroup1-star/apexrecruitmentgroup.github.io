import {ApexApp} from '@/components/apex-app';
import {one} from '@/lib/db';
import type {Metadata} from 'next';
export const dynamic='force-dynamic';
export async function generateMetadata({params}:{params:Promise<{id:string}>}):Promise<Metadata>{const {id}=await params;try{const r=await one("SELECT data FROM records WHERE id=? AND kind='vacancy' AND status='Published'",id);if(r){const d=JSON.parse(r.data);return {title:d.title,description:d.summary||`${d.title} in ${d.location}. Apply with Apex Global Services LLC.`,openGraph:{title:d.title,description:d.summary||d.location,images:[]},twitter:{title:d.title,description:d.summary||d.location,images:[]}}}}catch{}return {title:'Vacancy',robots:{index:false,follow:false},openGraph:{images:[]},twitter:{images:[]}}}
export default async function Vacancy({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ApexApp page="job" jobId={id}/>}
