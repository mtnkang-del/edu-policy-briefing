import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import Parser from 'rss-parser';

const DATA='docs/data/news.json';
const parser=new Parser({timeout:15000,headers:{'User-Agent':'Mozilla/5.0 EduPolicyBriefing/1.4'},customFields:{item:[['News:Source','newsSource']]}});
const clean=(s='')=>String(s).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const norm=(s='')=>clean(s).toLowerCase().replace(/[^0-9a-z가-힣]+/g,' ').trim();
const hash=s=>crypto.createHash('sha1').update(s).digest('hex').slice(0,12);
const queries=['South Korea education policy','Korea Ministry of Education university school policy','South Korea teachers students university admissions'];
function direct(link=''){try{const u=new URL(link);if(u.hostname.endsWith('bing.com'))return u.searchParams.get('url')||u.href;return u.href}catch{return link}}
function category(t=''){t=t.toLowerCase();if(/admission|exam|csat|입시|수능/.test(t))return'입시·사교육';if(/teacher|faculty|교사|교원/.test(t))return'교원·조직';if(/ai|digital|edtech|artificial intelligence/.test(t))return'AI·디지털';if(/university|college|higher education/.test(t))return'고등교육';if(/school|student|k-12/.test(t))return'유·초중등';if(/budget|funding|law/.test(t))return'재정·법령';return'기타'}
async function translate(text){
  const q=clean(text).slice(0,420); if(!q)return'';
  try{
    const u=`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en%7Cko&mt=1`;
    const r=await fetch(u,{headers:{'User-Agent':'EduPolicyBriefing/1.4'},signal:AbortSignal.timeout(8000)});
    if(!r.ok)return'';
    const j=await r.json();
    return clean(j?.responseData?.translatedText||'');
  }catch{return''}
}
const data=JSON.parse(await fs.readFile(DATA,'utf8'));
const existing=new Set((data.items||[]).map(x=>norm(x.title)));
let foreign=(data.items||[]).filter(x=>x.kind==='foreign');
if(foreign.length<8){
  const added=[];
  for(const q of queries){
    try{const url=`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=en-US`;const feed=await parser.parseURL(url);for(const x of feed.items||[]){const publishedAt=new Date(x.isoDate||x.pubDate||Date.now()).toISOString();if((Date.now()-new Date(publishedAt))/864e5>30)continue;let title=clean(x.title||'');const source=clean(x.newsSource||x.creator||(title.includes(' - ')?title.split(' - ').pop():'')||'Foreign press');if(source&&title.endsWith(` - ${source}`))title=title.slice(0,-(` - ${source}`.length));if(!title||!x.link||existing.has(norm(title)))continue;const item={id:hash(`foreign:${direct(x.link)}`),title,url:direct(x.link),source,kind:'foreign',publishedAt,description:clean(x.contentSnippet||x.content||x.summary||'').slice(0,420),category:category(title),score:30};existing.add(norm(title));added.push(item)}}catch(e){console.warn(`foreign fallback: ${e.message}`)}
  }
  foreign=[...foreign,...added].sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt)).slice(0,15);
  const nonForeign=(data.items||[]).filter(x=>x.kind!=='foreign');
  data.items=[...nonForeign,...foreign].sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,80);
}
if(!data.foreignTranslationEnabled&&foreign.length){
  let translated=0;
  for(const x of foreign.slice(0,15)){
    x.originalTitle=x.title;
    const tk=await translate(x.title); if(tk&&tk.toLowerCase()!==x.title.toLowerCase()){x.titleKo=tk;translated++}
    if(x.description){const sk=await translate(x.description);if(sk)x.summaryKo=sk}
  }
  data.foreignTranslationEnabled=translated>0;
  data.translationProvider=translated>0?'MyMemory MT fallback':'none';
}
data.stats={total:data.items.length,official:data.items.filter(x=>x.kind==='official').length,domestic:data.items.filter(x=>x.kind==='domestic').length,foreign:data.items.filter(x=>x.kind==='foreign').length};
await fs.writeFile(DATA,JSON.stringify(data,null,2),'utf8');
if(data.date)await fs.writeFile(`docs/data/archive/${data.date}.json`,JSON.stringify(data,null,2),'utf8');
console.log(`Foreign items=${data.stats.foreign}, translated=${data.foreignTranslationEnabled}`);
