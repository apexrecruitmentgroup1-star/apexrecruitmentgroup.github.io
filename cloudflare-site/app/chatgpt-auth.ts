// ChatGPT identity headers are trusted only behind the Sites gateway.
// Standalone Cloudflare uses verified Supabase email sessions exclusively.
export type ChatGPTUser = {userId:string;displayName:string;email:string;fullName:string|null};
export async function getChatGPTUser():Promise<ChatGPTUser|null>{return null;}
