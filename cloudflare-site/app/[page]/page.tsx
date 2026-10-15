import {ApexApp} from '@/components/apex-app';
import {notFound} from 'next/navigation';
import type {Metadata} from 'next';
export const dynamic='force-dynamic';
const titles:Record<string,string>={about:'About Apex',services:'Our Services',vacancies:'Vacancies',partnerships:'Training Partnerships',contact:'Contact',account:'Your Account','request-proposal':'Request a Proposal',dashboard:'Dashboard',admin:'Administration',privacy:'Privacy Policy',terms:'Terms'};
export async function generateMetadata({params}:{params:Promise<{page:string}>}):Promise<Metadata>{const {page}=await params;return {title:titles[page]||'Apex Global Services LLC',...(['dashboard','admin','account'].includes(page)?{robots:{index:false,follow:false}}:{})}}
export default async function Page({params}:{params:Promise<{page:string}>}){const {page}=await params;if(!titles[page])notFound();return <ApexApp page={page}/>}
