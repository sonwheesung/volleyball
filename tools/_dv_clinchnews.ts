// INDEPENDENT GUARD — 순위 확정(clinch) 뉴스 회귀 가드 (NEWS_SYSTEM §3.1, 2026-07-11).
//   대상: buildNewsFeed의 clinch 블록(PO진출/정규1위직행/PO탈락이 막 확정된 경기일을 연대기로).
//   독립 오라클: broadcast.ts의 day−1↔day 전이 패턴을 팀×경기일 브루트포스로 재현(teamClinch/teamTitleClinch
//     — 기존 단순 셀렉터. seasonClinchTransitions의 단조-롤링 로직과 **다른 코드 경로**라 상호 교차검증).
//   검사: ①확정 팀 수만큼 뉴스(집합 일치) ②확정일 이후에만 노출(leagueDay 게이트 A/B) ③중복 0(팀·종류당 1건·newsKey 유일)
//         ④탈락·1위·진출 3종 모두 발화 ⑤전 clinch 뉴스에 day 존재 ⑥결정론(2회 동일).
//   Usage: npx tsx tools/_dv_clinchnews.ts
import { resetLeagueBase, LEAGUE, SEASON } from '../data/league';
import { teamClinch, teamTitleClinch } from '../data/clinch';
import { buildNewsFeed, newsKey } from '../data/news';
import { SEASON_DAYS } from '../engine/calendar';
import type { NewsItem } from '../types';

const log = (m: string) => process.stdout.write(m + '\n');
type Kind = 'po' | 'title' | 'eliminated';

resetLeagueBase();
const MY = LEAGUE.teams[0].id;

// ── 독립 오라클: 경기일마다 (day−1 ↔ day) 전이를 팀별로 검사(broadcast.ts 패턴). 상태는 경기일에만 바뀜. ──
const matchDays = [...new Set(SEASON.map((f) => f.dayIndex))].sort((a, b) => a - b);
const oracle = new Set<string>(); // `${team}:${kind}:${day}`
const oracleByKind: Record<Kind, number> = { po: 0, title: 0, eliminated: 0 };
for (const t of LEAGUE.teams) {
  for (const d of matchDays) {
    if (d > SEASON_DAYS) continue;
    const poB = teamClinch(t.id, d - 1)?.state, poA = teamClinch(t.id, d)?.state;
    if (poB !== 'clinched' && poA === 'clinched') { oracle.add(`${t.id}:po:${d}`); oracleByKind.po++; }
    if (poB !== 'eliminated' && poA === 'eliminated') { oracle.add(`${t.id}:eliminated:${d}`); oracleByKind.eliminated++; }
    const tB = teamTitleClinch(t.id, d - 1)?.state, tA = teamTitleClinch(t.id, d)?.state;
    if (tB !== 'clinched' && tA === 'clinched') { oracle.add(`${t.id}:title:${d}`); oracleByKind.title++; }
  }
}

// ── 검증 대상: 완전 공개 피드(leagueDay=SEASON_DAYS) ──
const classify = (h: string): Kind => (h.includes('탈락') ? 'eliminated' : h.includes('1위') ? 'title' : 'po');
const clinchOf = (feed: NewsItem[]) => feed.filter((n) => n.kind === 'clinch');
const feed = buildNewsFeed([], [], [], 0, [], [], SEASON_DAYS, MY);
const clinchNews = clinchOf(feed);

const newsSet = new Set<string>();
const newsByKind: Record<Kind, number> = { po: 0, title: 0, eliminated: 0 };
let missingDay = 0;
for (const n of clinchNews) {
  const kind = classify(n.headline);
  newsByKind[kind]++;
  if (n.day == null) { missingDay++; continue; }
  newsSet.add(`${n.teamId}:${kind}:${n.day}`);
}

const V: string[] = [];

// ① 확정 팀 수만큼 뉴스 — 집합 완전 일치(팀·종류·확정일까지)
const onlyOracle = [...oracle].filter((k) => !newsSet.has(k));
const onlyNews = [...newsSet].filter((k) => !oracle.has(k));
if (onlyOracle.length) V.push(`오라클엔 있는데 뉴스 없음 ${onlyOracle.length}: ${onlyOracle.slice(0, 5).join(',')}`);
if (onlyNews.length) V.push(`뉴스엔 있는데 오라클 없음 ${onlyNews.length}: ${onlyNews.slice(0, 5).join(',')}`);
for (const k of ['po', 'title', 'eliminated'] as Kind[])
  if (newsByKind[k] !== oracleByKind[k]) V.push(`${k} 건수 불일치 news=${newsByKind[k]}≠oracle=${oracleByKind[k]}`);

// ④ 3종 모두 발화
for (const k of ['po', 'title', 'eliminated'] as Kind[]) if (oracleByKind[k] === 0) V.push(`${k} 오라클 0건(시즌이 3종을 다 만들지 않음 — 표본 확인)`);

// ⑤ 전 clinch 뉴스에 day 존재(최신순 정렬·2주 만료 대상)
if (missingDay) V.push(`day 없는 clinch 뉴스 ${missingDay}(실시간 뉴스는 day 필수)`);

// ③ 중복 0 — 팀·종류당 1건 & newsKey 유일
const teamKindSeen = new Set<string>(); let tkDup = 0;
for (const n of clinchNews) { const tk = `${n.teamId}:${classify(n.headline)}`; if (teamKindSeen.has(tk)) tkDup++; teamKindSeen.add(tk); }
if (tkDup) V.push(`팀·종류 중복 ${tkDup}(단조성 위반 — 전이가 여러 번 잡힘)`);
const keySeen = new Set<string>(); let keyDup = 0;
for (const n of clinchNews) { const kk = newsKey(n); if (keySeen.has(kk)) keyDup++; keySeen.add(kk); }
if (keyDup) V.push(`newsKey 충돌 ${keyDup}(읽음추적 깨짐)`);

// 빈 헤드라인/본문 0
const emptyHB = clinchNews.filter((n) => !n.headline?.trim() || !n.body?.trim()).length;
if (emptyHB) V.push(`빈 헤드라인/본문 ${emptyHB}`);
// 매달린 teamId 0
const badTeam = clinchNews.filter((n) => n.teamId && !LEAGUE.teams.some((t) => t.id === n.teamId)).length;
if (badTeam) V.push(`매달린 teamId ${badTeam}`);

// ② 스포일러 A/B — 각 종류의 최초 확정 이벤트: leagueDay=day−1 엔 없고, day 엔 있어야(확정일 이후에만 노출)
const firstOf = (kind: Kind): { team: string; day: number } | null => {
  let best: { team: string; day: number } | null = null;
  for (const key of oracle) { const [team, k, dStr] = key.split(':'); const day = Number(dStr);
    if (k === kind && (!best || day < best.day)) best = { team, day }; }
  return best;
};
const hasEvent = (feedX: NewsItem[], team: string, kind: Kind) => clinchOf(feedX).some((n) => n.teamId === team && classify(n.headline) === kind);
let abFail = 0;
const abDetail: string[] = [];
for (const kind of ['po', 'title', 'eliminated'] as Kind[]) {
  const f = firstOf(kind); if (!f) continue;
  const before = buildNewsFeed([], [], [], 0, [], [], f.day - 1, MY); // 확정일 직전 컷오프
  const at = buildNewsFeed([], [], [], 0, [], [], f.day, MY);          // 확정일 컷오프
  const leakBefore = hasEvent(before, f.team, kind); // 있으면 스포일러 누출
  const shownAt = hasEvent(at, f.team, kind);        // 없으면 발화 실패
  abDetail.push(`${kind}(${f.team}@${f.day}): before=${leakBefore ? 'LEAK' : 'ok'} at=${shownAt ? 'shown' : 'MISSING'}`);
  if (leakBefore || !shownAt) abFail++;
}
if (abFail) V.push(`스포일러 A/B 실패 ${abFail} — ${abDetail.join(' · ')}`);

// 첫 경기 전(leagueDay=−1) clinch 뉴스 0
const preSeason = clinchOf(buildNewsFeed([], [], [], 0, [], [], -1, MY)).length;
if (preSeason) V.push(`첫 경기 전 clinch 뉴스 ${preSeason}(스포일러)`);

// ⑥ 결정론 — 2회 빌드 동일(헤드라인+day 시퀀스)
const sig = (feedX: NewsItem[]) => clinchOf(feedX).map((n) => `${n.headline}@${n.day}`).join('|');
const det = sig(buildNewsFeed([], [], [], 0, [], [], SEASON_DAYS, MY)) === sig(feed);
if (!det) V.push('비결정론(2회 빌드 불일치)');

log('═══ 순위 확정(clinch) 뉴스 가드 (NEWS_SYSTEM §3.1) ═══');
log(`팀 ${LEAGUE.teams.length} · 오라클 이벤트 ${oracle.size} ${JSON.stringify(oracleByKind)}`);
log(`뉴스 clinch ${clinchNews.length}건 ${JSON.stringify(newsByKind)}`);
log(`집합 일치: 오라클\\뉴스 ${onlyOracle.length} · 뉴스\\오라클 ${onlyNews.length}`);
log(`스포일러 A/B: ${abDetail.join(' · ')}`);
log(`첫 경기 전 clinch=${preSeason} · 결정론=${det} · missingDay=${missingDay} · 팀종류중복=${tkDup} · newsKey충돌=${keyDup}`);
log('\n── clinch 뉴스(최신순) ──');
for (const n of clinchNews) log(`${n.big ? '★' : '·'} [${n.season + 1}][day ${n.day}] ${n.headline}`);

const ok = V.length === 0;
log(`\n무결성: ${ok ? '✅ 위반 0' : '❌ ' + V.join(' · ')}`);
log(`\nCLINCHNEWS_GUARD ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 2);
