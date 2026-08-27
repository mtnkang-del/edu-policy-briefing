import fs from 'node:fs/promises';

const DATA='docs/data/news.json';
const clean=s=>String(s??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const shiftDate=(date,days)=>{const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
const whyByCategory={
  '입시·사교육':'대입·수능·사교육 이슈는 학생·학부모 체감도가 높고 후속 안내와 현장 반응 점검이 중요합니다.',
  '유·초중등':'학교 현장 적용과 학생·학부모 영향이 큰 영역으로 시행 과정과 현장 수용성을 함께 볼 필요가 있습니다.',
  '고등교육':'대학 운영·재정·입학·연구 정책과 연결되는 만큼 대학 현장과 이해관계자 반응을 점검할 필요가 있습니다.',
  '교원·조직':'교원 업무·교권·인사와 직접 연결될 수 있어 현장 반응과 제도 운영상 쟁점을 살펴볼 필요가 있습니다.',
  'AI·디지털':'AI·디지털 전환 정책은 교육과정·교원역량·인프라와 연결되므로 실행 여건과 현장 적용성을 함께 봐야 합니다.',
  '재정·법령':'예산·법령 변화는 정책 집행의 직접 근거가 되므로 세부 기준과 시행 일정 확인이 중요합니다.',
  '지역·평생교육':'지역 격차와 평생학습 접근성에 영향을 줄 수 있어 지역별 집행 여건을 점검할 필요가 있습니다.',
  '기타':'교육정책과 연계되는 후속 논의와 현장 반응을 지속적으로 확인할 필요가 있습니다.'
};

function statsOf(items){
  return {
    total:items.length,
    official:items.filter(x=>x.kind==='official').length,
    domestic:items.filter(x=>x.kind==='domestic').length,
    foreign:items.filter(x=>x.kind==='foreign').length
  };
}

function fallbackDigest(reportDate,dataDate,items,stats,windowStart,windowEnd){
  const sorted=[...items].sort((a,b)=>(b.score||0)-(a.score||0)||new Date(b.publishedAt)-new Date(a.publishedAt));
  const counts=new Map();
  for(const x of sorted) counts.set(x.category||'기타',(counts.get(x.category||'기타')||0)+1);
  const cats=[...counts.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
  const preferred=cats.filter(x=>x!=='기타').slice(0,4);
  const chosen=preferred.length?preferred:cats.slice(0,4);
  const issues=chosen.map(cat=>{
    const rows=sorted.filter(x=>(x.category||'기타')===cat).slice(0,3);
    return {
      title:cat,
      summary:rows.map(x=>clean(x.titleKo||x.title)).filter(Boolean).join(' · '),
      why:whyByCategory[cat]||whyByCategory['기타'],
      sources:[...new Set(rows.map(x=>x.source).filter(Boolean))]
    };
  });
  const topTitles=sorted.slice(0,3).map(x=>clean(x.titleKo||x.title)).filter(Boolean);
  const focus=chosen.slice(0,3).join('·')||'주요 교육정책';
  return {
    ai:false,
    date:reportDate,
    throughDate:dataDate,
    basis:'previous-day-plus-early-morning',
    windowStart:windowStart.toISOString(),
    windowEnd:windowEnd.toISOString(),
    stats,
    headline:sorted.length?`오늘 아침 교육뉴스는 ${focus} 이슈를 중심으로 형성됐습니다.`:'오늘 아침 브리핑 기준 확인된 교육뉴스가 없습니다.',
    summary:sorted.length
      ? `전일 00시부터 오늘 아침 갱신 시각까지 확인된 교육 관련 기사는 총 ${stats.total}건입니다. 교육부 공식 ${stats.official}건, 국내 언론 ${stats.domestic}건, 해외 언론 ${stats.foreign}건을 종합하면 ${topTitles.join(' / ')} 등이 주요 흐름으로 확인됩니다.`
      : '전일 00시부터 오늘 아침 갱신 시각까지 확인된 교육 관련 기사가 없습니다.',
    issues,
    watchpoints:issues.slice(0,3).map(x=>`${x.title}: ${x.why}`)
  };
}

async function aiDigest(reportDate,dataDate,fallback,items,stats,windowStart,windowEnd){
  if(!process.env.OPENAI_API_KEY||!items.length) return fallback;
  try{
    const OpenAI=(await import('openai')).default;
    const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
    const rows=items.slice(0,35).map((x,i)=>({i,title:x.title,titleKo:x.titleKo||'',source:x.source,kind:x.kind,category:x.category,description:x.description||'',summary:x.summary||x.summaryKo||''}));
    const prompt=`너는 대한민국 교육부 정책 담당자를 위한 아침 브리핑 편집자다. 아래 뉴스는 ${reportDate} 00:00 KST부터 ${dataDate} 아침 갱신 시각까지 수집된 기사다. 이 목록만 근거로 같은 사건의 중복 보도를 하나의 이슈로 묶어 한국어 브리핑을 작성하라. 사실을 추가하거나 추측하지 마라. JSON만 출력한다. 형식은 {"headline":"아침 교육뉴스 전체를 한 문장으로 총평","summary":"전체 흐름을 3~4문장으로 요약","issues":[{"title":"이슈명","summary":"무슨 일이 있었는지 2문장 이내","why":"교육부가 왜 봐야 하는지 1문장","sources":["출처"]}],"watchpoints":["오늘 아침 확인할 점"]}. issues는 최대 5개, watchpoints는 최대 4개. 기사 목록: ${JSON.stringify(rows)}`;
    const r=await client.responses.create({model:process.env.OPENAI_MODEL||'gpt-5-mini',input:prompt});
    const m=(r.output_text||'').match(/\{[\s\S]*\}/);
    if(!m) return fallback;
    const p=JSON.parse(m[0]);
    return {
      ai:true,
      date:reportDate,
      throughDate:dataDate,
      basis:'previous-day-plus-early-morning',
      windowStart:windowStart.toISOString(),
      windowEnd:windowEnd.toISOString(),
      stats,
      headline:clean(p.headline)||fallback.headline,
      summary:clean(p.summary)||fallback.summary,
      issues:(p.issues||[]).slice(0,5).map(x=>({title:clean(x.title),summary:clean(x.summary),why:clean(x.why),sources:(x.sources||[]).map(clean).filter(Boolean).slice(0,4)})).filter(x=>x.title),
      watchpoints:(p.watchpoints||[]).map(clean).filter(Boolean).slice(0,4)
    };
  }catch(e){console.warn(`Daily digest AI failed: ${e.message}`);return fallback;}
}

const data=JSON.parse(await fs.readFile(DATA,'utf8'));
const reportDate=shiftDate(data.date,-1);
const windowStart=new Date(`${reportDate}T00:00:00+09:00`);
const windowEnd=new Date(data.generatedAt||Date.now());
const reportItems=(data.items||[]).filter(x=>{
  const t=new Date(x.publishedAt||0);
  return !Number.isNaN(t.getTime())&&t>=windowStart&&t<=windowEnd;
});
const stats=statsOf(reportItems);
const fallback=fallbackDigest(reportDate,data.date,reportItems,stats,windowStart,windowEnd);
data.dailyDigest=await aiDigest(reportDate,data.date,fallback,reportItems,stats,windowStart,windowEnd);
await fs.writeFile(DATA,JSON.stringify(data,null,2),'utf8');
if(data.date) await fs.writeFile(`docs/data/archive/${data.date}.json`,JSON.stringify(data,null,2),'utf8');
console.log(`Morning digest built from ${reportItems.length} items (${reportDate} 00:00 KST through refresh). AI=${data.dailyDigest.ai}`);
