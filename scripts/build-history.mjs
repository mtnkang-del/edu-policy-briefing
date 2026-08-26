import fs from 'node:fs/promises';
import path from 'node:path';

const archiveDir='docs/data/archive';
const out='docs/data/history.json';
const clean=s=>String(s??'').toLowerCase().replace(/<[^>]+>/g,' ').replace(/[^0-9a-z가-힣]+/g,' ').replace(/\s+/g,' ').trim();

let files=[];
try{files=(await fs.readdir(archiveDir)).filter(x=>/^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().reverse().slice(0,30)}catch{}

const seen=new Set();
const items=[];
for(const file of files){
  try{
    const d=JSON.parse(await fs.readFile(path.join(archiveDir,file),'utf8'));
    for(const x of d.items||[]){
      const url=String(x.url||'');
      const stableUrl=url&&!/google\.com\/rss|bing\.com\/news/i.test(url)?url:'';
      const key=stableUrl||`${clean(x.title)}|${clean(x.source)}`;
      if(!key||seen.has(key))continue;
      seen.add(key);
      items.push({...x,snapshotDate:d.date||file.slice(0,10)});
    }
  }catch(e){console.warn(`history skip ${file}: ${e.message}`)}
}
items.sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));
const payload={generatedAt:new Date().toISOString(),retentionDays:30,days:files.map(x=>x.slice(0,10)),items:items.slice(0,600)};
await fs.writeFile(out,JSON.stringify(payload,null,2),'utf8');
console.log(`History built: ${payload.days.length} days, ${payload.items.length} unique items`);
