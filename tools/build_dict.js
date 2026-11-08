// 辞書データを、アプリで使う小さなファイルに加工するスクリプト
//   node tools/build_dict.js es <kaikki.org-dictionary-Spanish.jsonl.gz> dict/es
//   node tools/build_dict.js en <EJDictのsrcフォルダ> dict/en
// 出力：dict/<lang>/<先頭2文字>.json（{ 単語: [項目, ...] }）
// 項目：{ p: 品詞, i: 発音, g: 意味（短く）, f: 活用・変化表, of: [[原形, 変化の種類], ...] }
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), readline = require('readline');

const [, , lang, src, outDir] = process.argv;
if (!lang || !src || !outDir) { console.error('usage: node tools/build_dict.js es|en <src> <outDir>'); process.exit(1); }

const stripAcc = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const shardOf = w => { const k = stripAcc(w.toLowerCase()).replace(/[^a-z]/g, ''); return (k.slice(0, 2) || '_').padEnd(2, '_'); };
const dict = new Map(); // 単語 → 項目の配列
const add = (w, e) => { const k = w.toLowerCase(); if (!dict.has(k)) dict.set(k, []); dict.get(k).push(e); };

// ---------- スペイン語（Wiktionary / kaikki.org） ----------
const POS = { verb: '動詞', noun: '名詞', adj: '形容詞', adv: '副詞', prep: '前置詞', conj: '接続詞', pron: '代名詞', article: '冠詞', det: '限定詞',
  intj: '間投詞', num: '数詞', phrase: '熟語・フレーズ', prep_phrase: '熟語・フレーズ', contraction: '縮約形', particle: '小辞', proverb: 'ことわざ', adv_phrase: '熟語・フレーズ' };
const SKIP_POS = new Set(['name', 'prefix', 'suffix', 'infix', 'character', 'symbol', 'romanization', 'abbrev']);
const PERSON = [['first-person', 'singular', 'yo'], ['second-person', 'singular', 'tú'], ['third-person', 'singular', 'él'],
  ['first-person', 'plural', 'nosotros'], ['second-person', 'plural', 'vosotros'], ['third-person', 'plural', 'ellos']];
const TENSES = [ // [日本語, 必要なタグ]
  ['直説法現在', ['indicative', 'present']], ['点過去', ['indicative', 'preterite']], ['線過去', ['indicative', 'imperfect']],
  ['未来', ['indicative', 'future']], ['過去未来', ['conditional']], ['接続法現在', ['subjunctive', 'present']], ['接続法過去', ['subjunctive', 'imperfect']],
];
const BAD = ['vos-form', 'combined-form', 'negative', 'imperfect-se', 'formal', 'second-person-semantically', 'archaic', 'obsolete'];
// 動詞のタグ → 「点過去 yo」のようなラベル（使わないものは null）
function verbLabel(tags) {
  const t = new Set(tags);
  if (BAD.some(b => t.has(b))) return null;
  if (t.has('gerund')) return '現在分詞';
  if (t.has('participle') && t.has('past')) return (t.has('feminine') || t.has('plural')) ? null : '過去分詞';
  if (t.has('infinitive')) return null;
  if (t.has('imperative')) {
    if (t.has('second-person') && t.has('singular') && t.has('informal')) return '命令法 tú';
    if (t.has('second-person') && t.has('plural')) return '命令法 vosotros';
    return null;
  }
  const tense = TENSES.find(([, need]) => need.every(n => t.has(n)) && !(need[0] === 'indicative' && t.has('conditional')));
  if (!tense || (t.has('subjunctive') && t.has('future'))) return null;
  const per = PERSON.find(([a, b]) => t.has(a) && t.has(b));
  return per ? `${tense[0]} ${per[2]}` : null;
}
// 名詞・形容詞・冠詞などのタグ → 「女性複数」など
function nomLabel(tags) {
  const t = new Set(tags);
  const g = t.has('masculine') ? '男性' : t.has('feminine') ? '女性' : t.has('neuter') ? '中性' : '';
  const n = t.has('plural') ? '複数' : t.has('singular') ? '単数' : '';
  if (t.has('diminutive')) return '縮小辞';
  if (t.has('augmentative')) return '増大辞';
  if (t.has('superlative')) return '最上級';
  if (t.has('comparative')) return '比較級';
  return (g + n) || null;
}
// 意味は「同じ意味の単語」程度に短く：かっこ書きを消し、最初の区切りまで
const shortGloss = g => {
  const segs = g.replace(/\s*\([^)]*\)/g, '').split(/\s*;\s*/).map(s => s.split(/:|, (?=[a-z])/)[0].replace(/\s+/g, ' ').trim()).filter(Boolean);
  const two = segs.slice(0, 2).join('; ');
  return (two.length <= 50 ? two : segs[0] || '').slice(0, 50);
};
const isLetterName = g => /^The name of the Latin[- ]script letter/i.test(g);

async function buildEs() {
  const rl = readline.createInterface({ input: fs.createReadStream(src).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (!line) continue;
    if (++n % 100000 === 0) console.error(`  ${n} 行…`);
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.lang_code !== 'es' || !e.word || SKIP_POS.has(e.pos)) continue;
    const pos = POS[e.pos] || '';
    const ipa = (e.sounds || []).find(s => s.ipa)?.ipa || '';
    const glosses = [], of = [];
    for (const s of e.senses || []) {
      if (s.form_of?.length) {
        for (const fo of s.form_of) {
          const lab = e.pos === 'verb' ? verbLabel(s.tags || []) : nomLabel(s.tags || []);
          if (fo.word && !of.some(([l, x]) => l === fo.word && x === lab)) of.push([fo.word, lab || '変化形']);
        }
        continue;
      }
      const g = s.glosses?.[s.glosses.length - 1];
      if (g && !isLetterName(g) && !(s.tags || []).some(t => t === 'obsolete' || t === 'archaic')) { const sg = shortGloss(g); if (sg && !glosses.includes(sg)) glosses.push(sg); }
    }
    // 同じ原形で、種類の書いてある変化形があれば「変化形」だけのものは消す
    for (let i = of.length - 1; i >= 0; i--) if (of[i][1] === '変化形' && of.some(([l, x], j) => j !== i && l === of[i][0] && x !== '変化形')) of.splice(i, 1);
    // 活用・変化表
    let forms = '';
    if (e.pos === 'verb') {
      const seen = new Set(), rows = [];
      for (const f of e.forms || []) {
        if (f.source !== 'conjugation' || !f.form || f.form.includes(' ')) continue; // 再帰形（me voy など）は除く
        const lab = verbLabel(f.tags || []);
        if (lab && !seen.has(lab)) { seen.add(lab); rows.push([lab, f.form]); }
      }
      const order = l => { const tIdx = TENSES.findIndex(([j]) => l.startsWith(j + ' ')); const pIdx = PERSON.findIndex(p => l.endsWith(' ' + p[2]));
        return tIdx >= 0 ? tIdx * 10 + pIdx : { '命令法 tú': 80, '命令法 vosotros': 81, '過去分詞': 90, '現在分詞': 91 }[l] ?? 99; };
      rows.sort((a, b) => order(a[0]) - order(b[0]));
      forms = rows.map(([l, f]) => `${l}: ${f}`).join('\n');
    } else if (['noun', 'adj', 'article', 'det', 'pron', 'num'].includes(e.pos)) {
      const rows = [], seen = new Set();
      for (const f of e.forms || []) {
        if (!f.form || f.form === e.word || (f.tags || []).some(t => ['table-tags', 'inflection-template', 'canonical', 'romanization'].includes(t))) continue;
        const lab = nomLabel(f.tags || []);
        if (lab && !seen.has(lab + f.form)) { seen.add(lab + f.form); rows.push(`${lab}: ${f.form}`); }
      }
      forms = rows.join('\n');
    }
    const cats = (e.categories || []).map(c => typeof c === 'string' ? c : c.name || '');
    const gender = e.pos === 'noun' ? (cats.some(c => /feminine nouns/.test(c)) && !cats.some(c => /masculine nouns/.test(c)) ? '（女性）'
      : cats.some(c => /masculine nouns/.test(c)) && !cats.some(c => /feminine nouns/.test(c)) ? '（男性）' : '') : '';
    if (!glosses.length && !of.length) continue;
    const item = {};
    if (pos) item.p = pos + gender;
    if (ipa) item.i = ipa;
    if (glosses.length) item.g = [...new Set(glosses.slice(0, 3).join('; ').split('; '))].join('; ');
    if (forms) item.f = forms;
    if (of.length) item.of = of.slice(0, 4);
    add(e.word, item);
  }
  console.error(`  合計 ${n} 行を読みました`);
}

// ---------- 英語（EJDict） ----------
const EN_FORM = [['過去分詞', '過去分詞'], ['過去', '過去形'], ['現在分詞', '-ing形'], ['複数', '複数形'], ['三人称単数', '三単現'], ['比較級', '比較級'], ['最上級', '最上級']];
function buildEn() {
  for (const f of fs.readdirSync(src).filter(f => f.endsWith('.txt'))) {
    for (const line of fs.readFileSync(path.join(src, f), 'utf8').split(/\r?\n/)) {
      const [words, mean] = line.split('\t'); if (!words || !mean) continue;
      // 「goの過去」のような変化形
      const m = mean.match(/^([A-Za-z][\w' -]*)の(過去分詞|過去|現在分詞|複数|三人称単数|比較級|最上級)/);
      // 意味は先頭3つまで・記号を整理
      const g = mean.split(' / ').slice(0, 3).map(s => s.replace(/《[^》]*》/g, '').replace(/[『』]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ').slice(0, 160);
      const item = { g };
      if (m) item.of = [[m[1], EN_FORM.find(([k]) => m[2].startsWith(k))[1]]];
      for (const w of words.split(',').map(s => s.trim()).filter(Boolean)) add(w, item);
    }
  }
}

(async () => {
  if (lang === 'es') await buildEs(); else if (lang === 'en') buildEn(); else throw new Error('lang は es か en');
  // 意味のある項目を先に。さらに機能語（前置詞・冠詞など）→ 動詞 → 形容詞 → 名詞 の順に並べる（「a」が名詞より前置詞になるように）
  const PRI = ['前置詞', '冠詞', '代名詞', '接続詞', '限定詞', '縮約形', '動詞', '形容詞', '副詞', '数詞', '間投詞', '熟語・フレーズ', '名詞'];
  const pri = x => { const i = PRI.findIndex(p => (x.p || '').startsWith(p)); return i < 0 ? PRI.length : i; };
  for (const items of dict.values()) items.sort((a, b) => ((b.g ? 1 : 0) - (a.g ? 1 : 0)) || (pri(a) - pri(b)));
  // 先頭2文字でファイルを分け、大きすぎるものは先頭の文字数を増やしてさらに分ける（スマホでも軽く読めるように）
  // アプリ側は index.json の split に入っている接頭辞なら、1文字長い接頭辞のファイルを読む
  const keyN = (w, n) => stripAcc(w.toLowerCase()).replace(/[^a-z]/g, '').slice(0, n).padEnd(n, '_');
  const LIMIT = 500 * 1024, split = [], files = new Map();
  const place = (entries, n) => {
    const groups = new Map();
    for (const [w, items] of entries) { const k = keyN(w, n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push([w, items]); }
    for (const [k, list] of groups) {
      const obj = Object.fromEntries(list);
      if (JSON.stringify(obj).length <= LIMIT || n >= 6 || k.endsWith('_')) files.set(k, obj);
      else { split.push(k); place(list, n + 1); }
    }
  };
  place([...dict], 2);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let total = 0, max = 0;
  // ファイル名は「k_」を付ける（Windowsでは aux・con などの名前のファイルを作れないため）
  for (const [s, obj] of files) { const txt = JSON.stringify(obj); total += txt.length; max = Math.max(max, txt.length); fs.writeFileSync(path.join(outDir, 'k_' + s + '.json'), txt); }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ split, words: dict.size }));
  console.error(`単語 ${dict.size} 語 → ${files.size} ファイル（合計 ${(total / 1048576).toFixed(1)} MB、最大 ${(max / 1024).toFixed(0)} KB）`);
})();
