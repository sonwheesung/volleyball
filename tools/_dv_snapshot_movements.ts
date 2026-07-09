// 진단 스냅샷 이동 연표 캡처 검증(2026-07-10) — buildDiagnosticSnapshot가 FA 이적·드래프트·외국인 교체를
// (1) movements에 범위 필터로 담고 (2) 뉴스에 내 팀 FA in/out을 띄우는지. 순수 함수라 합성 입력으로 결정론 확인.
import { buildDiagnosticSnapshot, SNAPSHOT_SPAN } from '../data/diagnosticSnapshot';
import type { SnapshotInput } from '../data/diagnosticSnapshot';
import type { Transfer, DraftPickRecord, ForeignSwapRecord } from '../types';

const CUR = 12; // 현재 시즌(0-based). 범위 = [max(0,12-10)=2 .. 12]
const IN = 5;   // 범위 안
const OUT = 0;  // 범위 밖(2 미만)

const transfers: Transfer[] = [
  { season: IN, playerId: 'p1', name: '가나다', fromTeam: 'A', toTeam: 'MYTEAM', kind: 'transfer', ovr: 80 }, // 내 팀 IN(범위)
  { season: IN, playerId: 'p2', name: '라마바', fromTeam: 'MYTEAM', toTeam: 'B', kind: 'transfer', ovr: 78 }, // 내 팀 OUT(범위)
  { season: IN, playerId: 'p3', name: '사아자', fromTeam: 'C', toTeam: 'D', kind: 'transfer', ovr: 75 },      // 타팀↔타팀(범위)
  { season: OUT, playerId: 'p4', name: '차카타', fromTeam: 'E', toTeam: 'F', kind: 'transfer', ovr: 70 },     // 범위 밖 → 제외돼야
];
const draft: DraftPickRecord[] = [
  { season: IN, teamId: 'MYTEAM', playerId: 'r1', name: '신인일', position: 'OH', round: 1, overallPick: 3 },
  { season: OUT, teamId: 'A', playerId: 'r2', name: '신인이', position: 'MB', round: 2, overallPick: 9 }, // 범위 밖
];
const foreign: ForeignSwapRecord[] = [
  { season: IN, teamId: 'MYTEAM', asian: false, outId: 'f0', outName: '올드', inId: 'f1', inName: '뉴' },
  { season: OUT, teamId: 'B', asian: true, inId: 'aq1', inName: '아시아' }, // 범위 밖
];

const input: SnapshotInput = {
  season: CUR, currentDay: 200, myTeamId: 'MYTEAM', engineVersion: 1,
  archive: [], milestones: [], hallOfFame: [], retirements: [], released: [],
  players: [], logs: [], now: 1_700_000_000_000,
  transfers, seasonDraftLog: draft, seasonForeignLog: foreign,
  replay: null,
};

const snap = buildDiagnosticSnapshot(input);
const m = snap.movements;

let fail = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { console.log('  ✗ ' + msg); fail++; } else console.log('  ✓ ' + msg); };

console.log(`SNAPSHOT_SPAN=${SNAPSHOT_SPAN}, 범위 ${snap.meta.fromSeason}..${snap.meta.toSeason}`);
console.log('[movements — 범위 필터]');
ok(m.transfers.length === 3, `transfers 범위내 3건 (실제 ${m.transfers.length}) — 범위밖 p4 제외`);
ok(!m.transfers.some((t) => t.playerId === 'p4'), 'p4(범위밖) 제외됨');
ok(m.draft.length === 1 && m.draft[0].playerId === 'r1', `draft 범위내 1건(r1) (실제 ${m.draft.length})`);
ok(m.foreign.length === 1 && m.foreign[0].inId === 'f1', `foreign 범위내 1건(f1) (실제 ${m.foreign.length})`);

console.log('[news — 내 팀 FA in/out 기사화]');
const allNews = snap.seasons.flatMap((s) => s.news);
const faNews = allNews.filter((n) => n.kind === 'transfer' || n.kind === 'release' || /이적|영입|떠나|방출|이별|합류|입단/.test(n.headline + (n.body ?? '')));
console.log(`  뉴스 총 ${allNews.length}건, FA/이적성 ${faNews.length}건`);
// 내 팀 IN(가나다)·OUT(라마바)이 뉴스에 등장하는지(헤드라인/본문)
const hasIn = allNews.some((n) => (n.headline + (n.body ?? '')).includes('가나다'));
const hasOut = allNews.some((n) => (n.headline + (n.body ?? '')).includes('라마바'));
ok(hasIn, '내 팀 영입(가나다) 뉴스 노출');
ok(hasOut, '내 팀 유출(라마바) 뉴스 노출');

console.log(fail === 0 ? '\n✅ PASS — 스냅샷이 FA/선수 이동을 movements+뉴스로 담는다' : `\n❌ FAIL ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
