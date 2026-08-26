import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 EduPolicyBriefing/1.3' },
  customFields: { item: [['News:Source', 'newsSource']] }
});

const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, 'docs', 'data');
const ARCHIVE_DIR = path.join(OUT_DIR, 'archive');
const now = new Date();
const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const yyyyMmDd = kst.toISOString().slice(0, 10);

const domesticQueries = [
  '교육부 교육정책',
  '교육 정책 학교 교원 대학 수능 사교육',
  'AI 디지털 교육 정책'
];
const foreignQueries = [
  'South Korea education policy',
  'Korea Ministry of Education university school policy',
  'South Korea teachers students university admissions'
];

const categoryRules = [
  ['입시·사교육', ['수능','대학수학능력시험','모의평가','대입','입시','사교육','학원','정시','수시','원서접수','admission','exam','csat']],
  ['AI·디지털', [' ai ','ai·','(ai)','인공지능','디지털','에듀테크','edtech','digital','artificial intelligence']],
  ['교원·조직', ['교사','교원','교육감','교직','교권','teacher','faculty']],
  ['고등교육', ['대학','대학교','국립대','전문대','등록금','연구','university','college','higher education']],
  ['유·초중등', ['영유아','유치원','초등','중학교','고등학교','학교','학생','돌봄','늘봄','school','student','k-12']],
  ['재정·법령', ['교부금','예산','재정','법안','법률','시행령','funding','budget','law']],
  ['지역·평생교육', ['문해교육','지역','평생교육','지방','지역대학','lifelong','regional']]
];

const clean = (s='') => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s='') => clean(s).toLowerCase().replace(/\[[^\]]+\]/g, '').replace(/[^0-9a-z가-힣]+/g, ' ').trim();
const hash = (s='') => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
function categoryFor(text='') {
  const t = ` ${String(text).toLowerCase()} `;
  for (const [cat, words] of categoryRules) if (words.some(w => t.includes(w.toLowerCase()))) return cat;
  return '기타';
}
function ageHours(date) { return Math.max(0, (Date.now() - new Date(date).getTime()) / 36e5); }
function scoreItem(item) {
  let score = item.kind === 'official' ? 45 : item.kind === 'foreign' ? 22 : 28;
  const age = ageHours(item.publishedAt);
  if (age <= 24) score += 25; else if (age <= 72) score += 15; else if (age <= 168) score += 5;
  const t = `${item.title} ${item.description}`.toLowerCase();
  for (const k of ['개편','발표','시행','법안','예산','수능','대입','교부금','교원','ai','university','education reform','budget','admissions']) if (t.includes(k)) score += 4;
  return score;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 EduPolicyBriefing/1.3' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}
function boardSeq(raw='') {
  const m = raw.match(/boardSeq[^0-9]{0,20}(\d{5,})/i)
    || raw.match(/(?:fnView|goView|viewBoard|boardView|fnDetail|goDetail|view)\s*\([^)]*?(\d{5,})/i);
  if (m?.[1] && m[1] !== '020402') return m[1];
  return [...raw.matchAll(/\d{5,}/g)].map(x => x[0]).find(x => x !== '020402' && Number(x) > 10000) || null;
}

async function fetchMOE() {
  const listUrl = 'https://www.moe.go.kr/boardCnts/listRenew.do?boardID=294&m=020402&page=1';
  const $ = cheerio.load(await fetchText(listUrl));
  const out = [];
  $('table tbody tr').each((_, tr) => {
    const row = $(tr), a = row.find('a').first(), title = clean(a.text());
    if (!title) return;
    const seq = boardSeq([a.attr('onclick') || '', row.attr('onclick') || '', row.html() || ''].join(' '));
    const cells = row.find('td').map((__, td) => clean($(td).text())).get();
    const date = cells.find(v => /^20\d{2}-\d{2}-\d{2}$/.test(v)) || yyyyMmDd;
    const url = seq
      ? `https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=${seq}&lev=0&m=020402`
      : `${listUrl}&searchType=S&searchStr=${encodeURIComponent(title)}`;
    out.push({ id: hash(`moe:${seq || norm(title)}:${date}`), title, url, source:'교육부', kind:'official', publishedAt:`${date}T09:00:00+09:00`, description:'교육부 공식 보도자료', category:categoryFor(title) });
  });
  return out.slice(0, 30);
}

function bingRssUrl(q, locale='ko-KR') {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=${encodeURIComponent(locale)}`;
}
function directPublisherUrl(link='') {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith('bing.com')) {
      const target = u.searchParams.get('url');
      if (target) return target;
    }
    return u.href;
  } catch { return link; }
}
async function fetchBingNews(queries, kind) {
  const out = [], maxAge = kind === 'foreign' ? 24 * 7 : 24 * 3;
  for (const q of queries) {
    try {
      const feed = await parser.parseURL(bingRssUrl(q, kind === 'foreign' ? 'en-US' : 'ko-KR'));
      for (const x of feed.items || []) {
        let title = clean(x.title || '');
        const source = clean(x.newsSource || x.creator || (title.includes(' - ') ? title.split(' - ').pop() : '') || '언론');
        if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(` - ${source}`.length));
        const publishedAt = new Date(x.isoDate || x.pubDate || Date.now()).toISOString();
        if (!title || !x.link || ageHours(publishedAt) > maxAge) continue;
        const url = directPublisherUrl(x.link);
        const description = clean(x.contentSnippet || x.content || x.summary || '').slice(0, 500);
        out.push({ id:hash(`${kind}:${url}`), title, url, source, kind, publishedAt, description, category:categoryFor(`${title} ${description}`) });
      }
    } catch (e) { console.warn(`Bing RSS failed: ${q}: ${e.message}`); }
  }
  return out;
}

function dedupe(items) {
  const seen = new Set(), out = [];
  for (const item of items.sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt))) {
    const key = norm(item.title).slice(0, 110);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(item);
  }
  return out;
}

async function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  const OpenAI = (await import('openai')).default;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
async function translateForeign(items, client) {
  if (!client) return { items, translated:false };
  const foreign = items.filter(x => x.kind === 'foreign').slice(0, 35);
  if (!foreign.length) return { items, translated:false };
  try {
    const input = foreign.map((x,i) => ({ i, title:x.title, description:x.description, source:x.source }));
    const prompt = `다음은 한국 교육정책과 관련된 해외 언론 기사다. 각 기사의 제목을 자연스러운 한국어로 번역하고, 제공된 제목/설명만 근거로 한국어 1~2문장 요약을 작성하라. 고유명사와 수치는 보존하고 추측하지 마라. JSON만 출력: {"items":[{"i":0,"titleKo":"...","summaryKo":"..."}]}.\n${JSON.stringify(input)}`;
    const r = await client.responses.create({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', input: prompt });
    const m = (r.output_text || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('translation JSON missing');
    const parsed = JSON.parse(m[0]);
    const map = new Map((parsed.items || []).map(v => [v.i, v]));
    let fi = 0;
    const next = items.map(x => {
      if (x.kind !== 'foreign') return x;
      const t = map.get(fi++);
      return t ? { ...x, originalTitle:x.title, titleKo:clean(t.titleKo), summaryKo:clean(t.summaryKo) } : x;
    });
    return { items:next, translated:true };
  } catch (e) { console.warn(`Foreign translation failed: ${e.message}`); return { items, translated:false }; }
}
async function policyBrief(items, client) {
  if (!client || !items.length) return { items, briefing:null, ai:false };
  try {
    const candidates = items.slice(0, 24).map((x,i) => ({ i, title:x.titleKo || x.title, source:x.source, kind:x.kind, category:x.category, description:x.summaryKo || x.description }));
    const prompt = `너는 대한민국 교육부 정책 담당자를 위한 뉴스 브리핑 편집자다. 아래 정보만 근거로 분석하라. JSON만 출력: {"briefing":["핵심 1", "핵심 2", "핵심 3", "핵심 4", "핵심 5"],"items":[{"i":0,"summary":"한국어 2문장 이내","implication":"교육정책 관점 시사점 1문장","importance":1}]}. 외신도 한국어로 작성하고 한국 정책과 직접 관련성이 낮으면 중요도를 낮춰라.\n${JSON.stringify(candidates)}`;
    const r = await client.responses.create({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', input: prompt });
    const m = (r.output_text || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('brief JSON missing');
    const p = JSON.parse(m[0]);
    const next = items.map((x,idx) => {
      const e = (p.items || []).find(v => v.i === idx);
      return e ? { ...x, summary:clean(e.summary), implication:clean(e.implication), importance:Number(e.importance)||3 } : x;
    });
    return { items:next, briefing:p.briefing || null, ai:true };
  } catch (e) { console.warn(`AI briefing failed: ${e.message}`); return { items, briefing:null, ai:false }; }
}
function fallbackBriefing(items) { return items.slice(0,5).map(x => `${x.titleKo || x.title} — ${x.source}`); }

async function pruneArchives(days=30) {
  await fs.mkdir(ARCHIVE_DIR, { recursive:true });
  const files = await fs.readdir(ARCHIVE_DIR);
  const cutoff = new Date(`${yyyyMmDd}T00:00:00+09:00`); cutoff.setDate(cutoff.getDate() - (days - 1));
  let removed = 0;
  for (const file of files) {
    const m = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/); if (!m) continue;
    const d = new Date(`${m[1]}T00:00:00+09:00`);
    if (d < cutoff) { await fs.unlink(path.join(ARCHIVE_DIR, file)); removed++; }
  }
  return removed;
}

await fs.mkdir(ARCHIVE_DIR, { recursive:true });
const results = await Promise.allSettled([fetchMOE(), fetchBingNews(domesticQueries,'domestic'), fetchBingNews(foreignQueries,'foreign')]);
let items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
items = dedupe(items).map(x => ({ ...x, score:scoreItem(x) })).sort((a,b) => b.score - a.score).slice(0, 80);
const client = await getOpenAI();
const translated = await translateForeign(items, client); items = translated.items;
const briefed = await policyBrief(items, client); items = briefed.items;
const removedArchives = await pruneArchives(30);

const payload = {
  generatedAt:new Date().toISOString(), generatedAtKST:kst.toISOString().replace('Z','+09:00'), date:yyyyMmDd,
  aiSummaryEnabled:briefed.ai, foreignTranslationEnabled:translated.translated, retentionDays:30,
  briefing:briefed.briefing || fallbackBriefing(items),
  stats:{ total:items.length, official:items.filter(x=>x.kind==='official').length, domestic:items.filter(x=>x.kind==='domestic').length, foreign:items.filter(x=>x.kind==='foreign').length },
  items
};
await fs.writeFile(path.join(OUT_DIR,'news.json'), JSON.stringify(payload,null,2),'utf8');
await fs.writeFile(path.join(ARCHIVE_DIR,`${yyyyMmDd}.json`), JSON.stringify(payload,null,2),'utf8');
console.log(`Updated ${items.length} stories. translated=${translated.translated} removedArchives=${removedArchives}`);
