// 기기 진단 로그 버퍼 순수 헬퍼 검증 (BACKEND_SYSTEM §13.6 #44) — prune 시즌 경계·범위·상한·정렬.
// 사용: npx tsx tools/_dv_devicelog.ts
import './_gt_mock'; // AsyncStorage 스텁(deviceLog import 시 필요)
import { pruneBySeasons, entriesInRange, KEEP_SEASONS, type DiagLogEntry } from '../lib/deviceLog';

const fails: string[] = [];
const ck = (c: boolean, m: string) => { if (!c) fails.push(m); };

// 시즌 1..15, 각 시즌 3건
const mk = (): DiagLogEntry[] => {
  const out: DiagLogEntry[] = [];
  for (let s = 1; s <= 15; s++) for (let i = 0; i < 3; i++) out.push({ t: s * 1000 + i, season: s, cat: 'x', msg: `s${s}#${i}` });
  return out;
};

// prune: keep=10 @ maxSeason 15 → 시즌 6..15만(30건), 5시즌 이하 제거
const pruned = pruneBySeasons(mk(), KEEP_SEASONS);
const seasons = new Set(pruned.map((e) => e.season));
ck(Math.min(...seasons) === 6, `prune 하한 시즌=${Math.min(...seasons)} (기대 6)`);
ck(Math.max(...seasons) === 15, `prune 상한 시즌=${Math.max(...seasons)} (기대 15)`);
ck(pruned.length === 30, `prune 후 건수=${pruned.length} (기대 30)`);
ck(!pruned.some((e) => e.season <= 5), '5시즌 이하가 남아있음(prune 실패)');

// A/B(민감도): prune 안 하면 1시즌이 남아야(오라클이 실제로 거른다는 증거)
ck(mk().some((e) => e.season === 1), 'A/B: 원본에 1시즌 존재(대조군)');

// 하드 상한: max=5면 최근 5건만
const capped = pruneBySeasons(mk(), 99, 5);
ck(capped.length === 5, `상한 후 건수=${capped.length} (기대 5)`);
ck(capped.every((e) => e.season >= 14), '상한이 최근 것부터 유지 안 함');

// entriesInRange: currentSeason=15, keep=10 → 6..15, 시간순
const rng = entriesInRange(mk(), 15, 10);
ck(rng.length === 30, `범위 건수=${rng.length} (기대 30)`);
ck(rng[0].t <= rng[rng.length - 1].t, '시간순 정렬 아님');
ck(!rng.some((e) => e.season < 6 || e.season > 15), '범위 밖 엔트리 포함');
// currentSeason=8 → 미래(9~15) 제외
const rng8 = entriesInRange(mk(), 8, 10);
ck(!rng8.some((e) => e.season > 8), 'currentSeason=8인데 미래 시즌 포함(스포일러)');

console.log(fails.length ? '❌ FAIL\n  ' + fails.join('\n  ') : '✅ deviceLog 순수 헬퍼 PASS (prune 시즌경계·상한·범위·정렬·미래제외)');
process.exit(fails.length ? 1 : 0);
