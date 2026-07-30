// "한 경기 N점 폭발"(biggame) 기사 승패 인지 상비 가드 (NEWS_SYSTEM §4.6).
// 검증=Fable / 구현·가드=Opus 에이전트, 2026-07-30.
//   npx tsx tools/_dv_bignews.ts
//
// 버그(테스터 2026-07-30): biggame 기사가 승패를 모른 채 항상 승리 톤(POOLS.biggame)만 써서,
//   2:3 패배 속 33점 개인 폭발이 "한 경기를 통째로 끌고 갔다/에이스의 무게를 증명"으로 이긴 것처럼 읽힘.
//   수정: 그 경기 승패를 seasonResults(leagueDay) 룩업 → 이기면 biggame(승리 톤), 지면 biggameLoss(패배 톤).
//
// 검사(전부 실측·A/B):
//   (A) 정적 톤 분리: data/news.ts 소스에서 biggame·biggameLoss 두 풀을 파싱 → 둘 다 존재 +
//       승리 풀에 패배어('패배'/'졌') 0개, 패배 풀에 승리어('끌고 갔다'/'증명'/'떠받친') 0개.
//   (B) 실측 end-to-end 매핑: 여러 시드에서 실제 buildNewsFeed가 낸 biggame 기사를 seasonResults로
//       독립 계산한 그 경기 승패와 대조 → 이긴 경기=승리 톤 body, 진 경기=패배 톤 body(모호 0건).
//   (C) A/B 뮤턴트(허위 오라클 금지): 구버그(결과-blind, 항상 승리 풀) 재현 body를 진 경기에 주입 →
//       "진 경기는 패배 톤" 규칙이 그 뮤턴트를 FAIL로 잡는지(검사기 이빨). 승리 톤 body가 'loss'로
//       분류되지 않음도 단언(두 오라클 분별력).
//
// 결정론 무관(표시 전용) · 커밋/README 편집은 메인 세션.

import { readFileSync } from 'fs';
import { join } from 'path';
import { resetLeagueBase, reseedLeague, LEAGUE } from '../data/league';
import { buildNewsFeed } from '../data/news';
import { seasonResults } from '../data/standings';

const log = (m: string) => process.stdout.write(m + '\n');
const fails: string[] = [];
const check = (ok: boolean, msg: string) => { log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fails.push(msg); };
const MAX = Number.MAX_SAFE_INTEGER;

// 코어 문장(POOLS 밖, 루프 인라인 분기) — news.ts와 문자 일치.
const WIN_CORE = '팀 공격을 통째로 짊어진 하루였다.';
const LOSS_CORE = '팀은 아쉽게 졌지만, 공격만은 오롯이 이 선수의 몫이었다.';

log('═══ biggame 기사 승패 인지 가드 (NEWS §4.6) ═══\n');

// ── 소스에서 두 풀 파싱(정적 근거 = 진짜 풀, 재선언 드리프트 방지) ──
const src = readFileSync(join(process.cwd(), 'data', 'news.ts'), 'utf8');
function poolArrays(name: string): { open: string[]; close: string[] } {
  const start = src.indexOf(`  ${name}: {`);
  if (start < 0) throw new Error(`풀 '${name}' 블록을 소스에서 못 찾음`);
  const end = src.indexOf('\n  },', start);
  const block = src.slice(start, end);
  const strs = (s: string) => [...s.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const openM = block.match(/open:\s*\[([\s\S]*?)\]/);
  const closeM = block.match(/close:\s*\[([\s\S]*?)\]/);
  if (!openM || !closeM) throw new Error(`풀 '${name}' open/close 파싱 실패`);
  return { open: strs(openM[1]), close: strs(closeM[1]) };
}

let win: { open: string[]; close: string[] } | null = null;
let loss: { open: string[]; close: string[] } | null = null;
try {
  win = poolArrays('biggame');
  loss = poolArrays('biggameLoss');
} catch (e) {
  check(false, `풀 파싱: ${(e as Error).message}`);
}

// ── (A) 정적 톤 분리 ──
if (win && loss) {
  const WIN_MARKERS = [...win.open, ...win.close];
  const LOSS_MARKERS = [...loss.open, ...loss.close];
  check(WIN_MARKERS.length >= 3 && LOSS_MARKERS.length >= 3,
    `(A) 두 풀 존재 — biggame open+close=${WIN_MARKERS.length}, biggameLoss open+close=${LOSS_MARKERS.length}`);
  const winText = WIN_MARKERS.join('|');
  const lossText = LOSS_MARKERS.join('|');
  const winHasLossWord = ['패배', '졌'].filter((w) => winText.includes(w));
  const lossHasWinWord = ['끌고 갔다', '증명', '떠받친'].filter((w) => lossText.includes(w));
  check(winHasLossWord.length === 0, `(A) 승리 풀에 패배어 없음 (누출=${winHasLossWord.join(',') || '없음'})`);
  check(lossHasWinWord.length === 0, `(A) 패배 풀에 승리어 없음 (누출=${lossHasWinWord.join(',') || '없음'})`);

  // 톤 분류기 — 실제 풀 마커 + 코어 문장 기반.
  const toneOf = (body: string): 'win' | 'loss' | 'ambiguous' => {
    const hasWin = WIN_MARKERS.some((m) => body.includes(m)) || body.includes(WIN_CORE);
    const hasLoss = LOSS_MARKERS.some((m) => body.includes(m)) || body.includes(LOSS_CORE);
    if (hasWin && !hasLoss) return 'win';
    if (hasLoss && !hasWin) return 'loss';
    return 'ambiguous';
  };

  // ── (B) 실측 end-to-end: 여러 시드의 실제 biggame 기사 톤 == 독립 계산 승패 ──
  let wonChecked = 0, lostChecked = 0, mismatch = 0, ambiguous = 0;
  const mmEx: string[] = [];
  let sampleWonBody = '', sampleLostBody = '', sampleLostName = '';
  for (let s = 0; s < 80; s++) {
    reseedLeague(s, s * 7 + 1);
    const wonBy = new Map<string, boolean>();
    for (const r of seasonResults(MAX)) {
      wonBy.set(`${r.dayIndex}:${r.homeTeamId}`, r.homeSets > r.awaySets);
      wonBy.set(`${r.dayIndex}:${r.awayTeamId}`, r.awaySets > r.homeSets);
    }
    const MY = LEAGUE.teams[0].id;
    const feed = buildNewsFeed([], [], [], 0, [], [], MAX, MY, []);
    for (const n of feed) {
      if (n.kind !== 'match' || !/한 경기 \d+점 폭발/.test(n.headline)) continue;
      const w = wonBy.get(`${n.day}:${n.teamId}`);
      const tone = toneOf(n.body ?? '');
      if (tone === 'ambiguous') { ambiguous++; if (mmEx.length < 3) mmEx.push(`ambiguous "${n.headline}"`); continue; }
      if (w === true) {
        wonChecked++;
        if (tone !== 'win') { mismatch++; if (mmEx.length < 3) mmEx.push(`WON→${tone} "${n.headline}"`); }
        if (!sampleWonBody) sampleWonBody = n.body ?? '';
      } else if (w === false) {
        lostChecked++;
        if (tone !== 'loss') { mismatch++; if (mmEx.length < 3) mmEx.push(`LOST→${tone} "${n.headline}"`); }
        if (!sampleLostBody) { sampleLostBody = n.body ?? ''; sampleLostName = n.headline; }
      }
    }
  }
  check(wonChecked >= 10 && lostChecked >= 10,
    `(B) 실측 표본 충분 — 승리 biggame=${wonChecked}건 · 패배 biggame=${lostChecked}건`);
  check(ambiguous === 0, `(B) 톤 모호 0건 (모호=${ambiguous})`);
  check(mismatch === 0,
    `(B) 승패↔톤 매핑 일치 (불일치=${mismatch}${mmEx.length ? ' :: ' + mmEx.join(' / ') : ''})`);
  log(`     승리 예시: ${sampleWonBody.slice(0, 60)}…`);
  log(`     패배 예시: ${sampleLostBody.slice(0, 60)}…`);

  // ── (C) A/B 뮤턴트(허위 오라클 금지) — 구버그(항상 승리 풀) 재현이 오라클에 FAIL하는가 ──
  {
    // 실제 패배 body는 loss, 실제 승리 body는 win으로 분류되어야(두 오라클 분별력).
    check(toneOf(sampleLostBody) === 'loss', `A/B: 실제 패배 body → 'loss' 분류 (실제=${toneOf(sampleLostBody)})`);
    check(toneOf(sampleWonBody) === 'win', `A/B: 실제 승리 body → 'win' 분류 (실제=${toneOf(sampleWonBody)})`);

    // 뮤턴트 = 구버그(결과-blind) 재현: 진 경기에 승리 풀 open/close + 승리 코어를 붙인 body.
    //   (실제 승리 풀 문구 사용 — 재선언 아님. 스탯 절은 승패 무관 중립이라 톤에 무영향.)
    const mutantBody = `${win.open[0]} 선수가 한 경기 32점을 몰아쳤다. ${WIN_CORE} 상대 팀을 상대로 공격 성공 25개를 곁들였다. ${win.close[0]}`;
    const mutantTone = toneOf(mutantBody);
    // 이 뮤턴트가 "진 경기"에 달렸다고 가정 → (B) 규칙 "진 경기=loss"가 위반(win≠loss)을 잡아야 이빨.
    const caught = mutantTone !== 'loss';
    check(mutantTone === 'win', `A/B: 구버그 재현 body(승리 풀+승리 코어) → 'win' 분류 (실제=${mutantTone})`);
    check(caught,
      `A/B: 뮤턴트가 진 경기(${sampleLostName})에 달렸다면 (B)의 "진 경기=loss" 규칙이 FAIL로 검출 — 검사기 이빨`);
  }
}

resetLeagueBase();
log('');
if (fails.length) { log(`BIGNEWS FAIL — ${fails.length}건: ${fails.join(' / ')}`); process.exit(1); }
log('BIGNEWS PASS — 정적 톤 분리 · 실측 승패↔톤 매핑 · A/B 뮤턴트 자가검증');
process.exit(0);
