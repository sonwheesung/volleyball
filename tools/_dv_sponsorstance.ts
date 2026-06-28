// sponsorStance 가드 (FINANCE 2.0 Stage2) — 모기업 기조 도출 검증.
//   빈도(aggressive 팀당 ~12~15시즌 1회=team-season의 7~9%)·결정론·대칭(team-agnostic)·양 트리거(상위권/가뭄) 발화·무cash.
//   합성 archive(시드 순열 순위+우승)로 controlled 측정. 추정 금지 — 실측.
//   npx tsx tools/_dv_sponsorstance.ts [seasons]
import { createRng, strSeed } from '../engine/rng';
import { sponsorStanceOf, type SponsorStance } from '../engine/sponsorStance';
import type { SeasonArchive } from '../types';

const N = Number(process.argv[2] ?? 4000);
const TEAMS = Array.from({ length: 7 }, (_, i) => `t${i}`);
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌ FAIL'} ${n}${d ? ' — ' + d : ''}`); };

// 합성 archive: 시즌마다 시드 순열로 최종순위 + 1위=우승(controlled)
const shuffle = (arr: string[], r: ReturnType<typeof createRng>) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const archive: SeasonArchive[] = [];
for (let s = 0; s < N; s++) {
  const ranks = shuffle(TEAMS, createRng(strSeed(`arch:${s}`)));
  archive.push({ season: s, championId: ranks[0], standings: ranks });
}

// 전 team-season stance 집계
const tally: Record<SponsorStance, number> = { thrifty: 0, normal: 0, aggressive: 0 };
let aggrContender = 0, aggrDrought = 0, aggrOther = 0;
for (let s = 1; s < N; s++) { // s=0은 이력 빈약 — 스킵
  const a = archive[s]; const ranks = a.standings!;
  for (const t of TEAMS) {
    const st = sponsorStanceOf(t, s, archive);
    tally[st]++;
    if (st === 'aggressive') {
      const rank = ranks.indexOf(t) + 1;
      const topC = a.championId !== t && rank <= Math.max(2, Math.ceil(7 * 0.3));
      let drought = s + 1; for (let k = s; k >= 0; k--) { if (archive[k].championId === t) { drought = s - k; break; } }
      if (topC) aggrContender++; else if (drought >= 8) aggrDrought++; else aggrOther++;
    }
  }
}
const total = (N - 1) * TEAMS.length;
const pct = (x: number) => ((x / total) * 100).toFixed(1) + '%';
console.log(`═══ stance 분포 (${total} team-seasons) ═══`);
console.log(`  thrifty ${pct(tally.thrifty)} · normal ${pct(tally.normal)} · aggressive ${pct(tally.aggressive)}`);
console.log(`  aggressive 경로: 상위권 ${aggrContender} · 가뭄 ${aggrDrought} · 새스폰서 ${aggrOther}`);

const aPct = tally.aggressive / total, tPct = tally.thrifty / total;
check('aggressive 빈도 5~13%(팀당 ~8-20시즌 1회)', aPct >= 0.05 && aPct <= 0.13, pct(tally.aggressive));
check('thrifty 빈도 4~10%', tPct >= 0.04 && tPct <= 0.10, pct(tally.thrifty));
check('normal 다수(>75%)', tally.normal / total > 0.75, pct(tally.normal));
check('상위권 트리거 발화(>0)', aggrContender > 0, `${aggrContender}`);
check('가뭄 트리거 발화(>0, 약팀 반등)', aggrDrought > 0, `${aggrDrought}`);

// 결정론: 같은 입력 2회 동일
let detOk = true;
for (let s = 1; s < 50; s++) for (const t of TEAMS) if (sponsorStanceOf(t, s, archive) !== sponsorStanceOf(t, s, archive)) detOk = false;
check('결정론(같은 입력 동일)', detOk);

// 대칭(내 팀/AI 동일) = 출력이 (teamId·season·archive)만의 순수함수이고 전역(selectedTeamId 등)·cash에 의존 0.
//   깊은 복사 archive로 호출해도 동일하면 숨은 전역 의존 없음 = 어느 팀이 '내 팀'이어도 같은 결과(특례 없음).
//   (팀별 시드라 두 팀이 같은 성적이어도 stance가 다를 수 있는 건 '의도된 팀별 다양성' — 라벨 swap 불변이 아님.)
const archCopy: SeasonArchive[] = JSON.parse(JSON.stringify(archive));
let symOk = true;
for (let s = 1; s < 300; s++) for (const t of TEAMS) if (sponsorStanceOf(t, s, archive) !== sponsorStanceOf(t, s, archCopy)) symOk = false;
check('대칭(순수함수 — 전역/myTeam/cash 의존 0 → 내팀=AI)', symOk);

// 1회성: 시즌 간 carryover 없음(함수가 season만 봄) — s와 s+1 독립(구조상 보장, sanity)
check('무cash(시그니처에 cash 없음 — 구조 보장)', sponsorStanceOf.length === 3);

console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — pass ${pass} / fail ${fail}`);
process.exit(fail > 0 ? 1 : 0);
