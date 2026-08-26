import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 EduPolicyBriefing/1.0' }
});

const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, 'docs', 'data');
const ARCHIVE_DIR = path.join(OUT_DIR, 'archive');
const now = new Date();
const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const yyyyMmDd = kst.toISOString().slice(0, 10);

const domesticQueries = [
  '교육부 교육정책 when:2d',
  '교육 정책 학교 교원 대학 수능 사교육 when:2d',
  'AI 디지털교과서 교육 when:3d'
];

const foreignQueries = [
  'South Korea education policy when:5d',
  'Korea Ministry of Education university school policy when:5d',
  'South Korea teachers students university admissions when:5d'
];

const categoryRules = [
  ['입시·사교육', ['수능','대입','입시','사교육','학원','정시','수시','admission','exam','CSAT']],
  ['유·초중등', ['유치원','초등','중학교','고등학교','학교','학생','돌봄','늘봄','school','student','K-12']],
  ['고등교육', ['대학','대학교','국립대','전문대','등록금','연구','university','college','higher education']],
  ['교원·조직', ['교사','교원','교육감','교직','교권','teacher','faculty']],
  ['AI·디지털', ['AI','인공지능','디지털','에듀테크','edtech','digital','artificial intelligence']],
  ['재정·법령', ['교부금','예산','재정','법안','법률','시행령','funding','budget','law']],
  ['지역·평생교육', ['지역','평생교육','지방','지역대학','lifelong','regional']],
];

function clean(s='') {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeTitle(s='') {
  return clean(s).toLowerCase().replace(/\[[^\]]+\]/g, '').replace(/[^0-9a-z가-힣]+/g, ' ').trim();
}
function hash(s='') { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12); }
function categoryFor(text='') {
  const lower = text.toLowerCase();
  for (const [cat, words] of categoryRules) if (words.some(w => lower.includes(w.toLowerCase()))) return cat;
  return '기타';
}
function scoreItem(item) {
  let score = item.kind === 'official' ? 45 : item.kind === 'foreign' ? 22 : 28;
  const ageHours = Math.max(0, (Date.now() - new Date(item.publishedAt).getTime()) / 36e5);
  if (ageHours <= 24) score += 25; else if (ageHours <= 72) score += 15; else if (ageHours <= 120) score += 5;
  const t = `${item.title} ${item.description}`;
  const highImpact = ['개편','발표','시행','법안','예산','수능','대입','교부금','교원','AI','인공지능','university','education reform','budget','admissions'];
  score += highImpact.filter(k => t.toLowerCase().includes(k.toLowerCase())).length * 4;
  return score;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 EduPolicyBriefing/1.0' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

async function fetchMOE() {
  const url = 'https://www.moe.go.kr/boardCnts/listRenew.do?boardID=294&m=020402&page=1';
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const items = [];
  $('table tbody tr').each((_, tr) => {
    const row = $(tr);
    const a = row.find('a').first();
    const title = clean(a.text());
    if (!title) return;
    let href = a.attr('href') || '';
    try { href = new URL(href, 'https://www.moe.go.kr').href; } catch { return; }
    const cells = row.find('td').map((__, td) => clean($(td).text())).get();
    const date = cells.find(v => /^20\d{2}-\d{2}-\d{2}$/.test(v)) || yyyyMmDd;
    items.push({
      id: hash(`moe:${href}`), title, url: href, source: '교육부', kind: 'official',
      publishedAt: `${date}T09:00:00+09:00`, description: '교육부 공식 보도자료', category: categoryFor(title)
    });
  });
  return items.slice(0, 30);
}

function googleRssUrl(q, locale='ko') {
  if (locale === 'ko') return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

async function fetchGoogleNews(queries, kind) {
  const all = [];
  for (const q of queries) {
    try {
      const feed = await parser.parseURL(googleRssUrl(q, kind === 'foreign' ? 'en' : 'ko'));
      for (const x of feed.items || []) {
        const source = clean(x.source?.name || x.creator || (x.title?.split(' - ').pop() ?? '언론'));
        let title = clean(x.title || '');
        if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(` - ${source}`.length));
        if (!title || !x.link) continue;
        const description = clean(x.contentSnippet || x.content || x.summary || '');
        all.push({
          id: hash(`${kind}:${x.link}`), title, url: x.link, source,
          kind, publishedAt: new Date(x.isoDate || x.pubDate || Date.now()).toISOString(),
          description: description.slice(0, 500), category: categoryFor(`${title} ${description}`)
        });
      }
    } catch (e) {
      console.warn(`RSS failed: ${q}: ${e.message}`);
    }
  }
  return all;
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items.sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt))) {
    const key = normalizeTitle(item.title).slice(0, 110);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(item);
  }
  return out;
}

async function aiEnhance(items) {
  if (!process.env.OPENAI_API_KEY || items.length === 0) return { items, briefing: null, ai: false };
  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const candidates = items.slice(0, 20).map((x, i) => ({ i, title: x.title, source: x.source, kind: x.kind, category: x.category, description: x.description }));
    const prompt = `너는 대한민국 교육부 정책 담당자를 위한 뉴스 브리핑 편집자다.\n아래 기사 목록만 근거로 분석하라. 과장하거나 사실을 추가하지 마라.\nJSON만 출력한다. 형식: {"briefing":["핵심 1",... 최대5개],"items":[{"i":0,"summary":"2문장 이내 요약","implication":"교육정책 관점 시사점 1문장","importance":1~5}]}.\n외신은 한국 교육정책에 직접 관련된 경우만 중요도를 높인다. 같은 이슈는 중복 설명하지 않는다.\n기사 목록:\n${JSON.stringify(candidates)}`;
    const r = await client.responses.create({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', input: prompt });
    const txt = r.output_text || '';
    const match = txt.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in model output');
    const parsed = JSON.parse(match[0]);
    const enriched = items.map((x, idx) => {
      const e = (parsed.items || []).find(v => v.i === idx);
      return e ? { ...x, summary: clean(e.summary), implication: clean(e.implication), importance: Number(e.importance) || 3 } : x;
    });
    return { items: enriched, briefing: parsed.briefing || null, ai: true };
  } catch (e) {
    console.warn(`AI enhancement failed: ${e.message}`);
    return { items, briefing: null, ai: false };
  }
}

function fallbackBriefing(items) {
  return items.slice(0, 5).map(x => `${x.title} — ${x.source}`);
}

await fs.mkdir(ARCHIVE_DIR, { recursive: true });
const results = await Promise.allSettled([
  fetchMOE(),
  fetchGoogleNews(domesticQueries, 'domestic'),
  fetchGoogleNews(foreignQueries, 'foreign')
]);

let items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
items = dedupe(items).map(x => ({ ...x, score: scoreItem(x) })).sort((a,b) => b.score - a.score).slice(0, 80);
const aiResult = await aiEnhance(items);
items = aiResult.items;

const payload = {
  generatedAt: new Date().toISOString(),
  generatedAtKST: kst.toISOString().replace('Z', '+09:00'),
  date: yyyyMmDd,
  aiSummaryEnabled: aiResult.ai,
  briefing: aiResult.briefing || fallbackBriefing(items),
  stats: {
    total: items.length,
    official: items.filter(x => x.kind === 'official').length,
    domestic: items.filter(x => x.kind === 'domestic').length,
    foreign: items.filter(x => x.kind === 'foreign').length
  },
  items
};

await fs.writeFile(path.join(OUT_DIR, 'news.json'), JSON.stringify(payload, null, 2), 'utf8');
await fs.writeFile(path.join(ARCHIVE_DIR, `${yyyyMmDd}.json`), JSON.stringify(payload, null, 2), 'utf8');
console.log(`Updated ${items.length} stories for ${yyyyMmDd}. AI=${aiResult.ai}`);
