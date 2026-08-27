import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

const DATA = 'docs/data/news.json';
const LIST = 'https://www.moe.go.kr/boardCnts/listRenew.do?boardID=294&m=020402&page=1';

const clean = (s='') => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s='') => clean(s).toLowerCase().replace(/[^0-9a-z가-힣]+/g, ' ').trim();
const hash = (s='') => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function boardSeq(raw='') {
  const named = raw.match(/boardSeq[^0-9]{0,20}(\d{5,})/i)
    || raw.match(/(?:fnView|goView|viewBoard|boardView|fnDetail|goDetail|view)\s*\([^)]*?(\d{5,})/i);
  if (named?.[1] && named[1] !== '020402') return named[1];
  return [...raw.matchAll(/\d{5,}/g)]
    .map(x => x[0])
    .find(x => x !== '020402' && Number(x) > 10000) || null;
}

function category(title='') {
  const t = title.toLowerCase();
  const rules = [
    ['입시·사교육', ['수능','대학수학능력시험','모의평가','대입','입시','사교육','학원','정시','수시모집','원서접수','admission','exam','csat']],
    ['AI·디지털', ['인공지능','디지털','에듀테크',' ai ','ai·','(ai)','edtech','digital','artificial intelligence']],
    ['교원·조직', ['교사','교원','교육감','교직','교권','teacher','faculty']],
    ['고등교육', ['대학','대학교','국립대','전문대','등록금','university','college','higher education']],
    ['유·초중등', ['영유아','유치원','초등','중학교','고등학교','학교','학생','돌봄','늘봄','school','student','k-12']],
    ['재정·법령', ['교부금','예산','재정','법안','법률','시행령','funding','budget','law']],
    ['지역·평생교육', ['문해교육','평생교육','지역','지방','lifelong','regional']]
  ];
  for (const [c, words] of rules) if (words.some(w => t.includes(w))) return c;
  return '기타';
}

async function loadMoeLookup() {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(LIST, {
        headers: { 'User-Agent': 'Mozilla/5.0 EduPolicyBriefing/1.2' },
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) throw new Error(`MOE list ${res.status}`);
      const html = await res.text();
      const $ = cheerio.load(html);
      const lookup = new Map();
      $('table tbody tr').each((_, tr) => {
        const row = $(tr);
        const a = row.find('a').first();
        const title = clean(a.text());
        if (!title) return;
        const raw = [a.attr('onclick') || '', row.attr('onclick') || '', a.attr('data-seq') || '', row.html() || ''].join(' ');
        lookup.set(norm(title), { title, seq: boardSeq(raw) });
      });
      return lookup;
    } catch (e) {
      lastError = e;
      if (attempt < 2) await sleep(1500);
    }
  }
  console.warn(`MOE link repair skipped after retries: ${lastError?.message || 'unknown error'}`);
  return null;
}

const data = JSON.parse(await fs.readFile(DATA, 'utf8'));
const lookup = await loadMoeLookup();
let fixed = 0;
let fallback = 0;

for (const item of data.items || []) {
  if (item.kind !== 'official' || item.source !== '교육부') continue;
  item.category = category(item.title);

  if (lookup) {
    const found = lookup.get(norm(item.title));
    const seq = found?.seq || null;
    item.url = seq
      ? `https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=294&boardSeq=${seq}&lev=0&m=020402`
      : `${LIST}&searchType=S&searchStr=${encodeURIComponent(item.title)}`;
    item.id = hash(`moe:${seq || norm(item.title)}:${item.publishedAt?.slice(0,10) || data.date}`);
    fixed++;
  } else if (!item.url || /moe\.go\.kr\/?#?$/.test(item.url)) {
    item.url = `${LIST}&searchType=S&searchStr=${encodeURIComponent(item.title)}`;
    fallback++;
  }
}

await fs.writeFile(DATA, JSON.stringify(data, null, 2), 'utf8');
if (data.date) await fs.writeFile(`docs/data/archive/${data.date}.json`, JSON.stringify(data, null, 2), 'utf8');
console.log(`MOE link repair complete: fixed=${fixed}, fallback=${fallback}, lookup=${lookup ? lookup.size : 0}`);
