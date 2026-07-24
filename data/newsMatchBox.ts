// 경기 뉴스 상세 셀렉터 (NEWS_SYSTEM §11.5) — "한 경기"로 환원되는 뉴스에서 그 경기 박스를 찾아 반환.
// 순수 셀렉터: UI(news/[id]) → data(여기) → engine. 신규 영속 0, 시드 순수 함수만 호출(결정론).
//
// 대상 3종만(그 외 kind·ref는 null → 스코어보드 미표시, 있는 것만 원칙):
//   match(트리플크라운·한경기폭발)·debut(데뷔전): n.day(dayIndex) + n.teamId → 정규 fixture → buildMatchBox.
//   playoff 경기별: n.ref='po:g'·'final:g'(숫자 g) → buildPlayoffBox. 시리즈 확정 'po:clinch'·그 외는 배제.
// 스포일러: 아이템 자체가 컷오프 게이트됨(피드에 존재 = 관전 완료). 여기선 n.day/n.ref가 가리키는 경기만
//   리플레이(임의 미래 경기 조회 금지 — "어느 경기를 재생할지"의 선택이 곧 게이트).

import { SEASON, getTeam, coachInfoOf } from './league';
import { buildMatchBox } from './matchBox';
import { buildPlayoffBox, type PoRound } from './postseason';
import { buildPlayoffs } from './playoffs';
import { interventionsFor } from './dynamics';
import type { BoxSink } from '../engine/rally';
import type { SimResult } from '../engine/simMatch';
import type { NewsItem, Player } from '../types';

export interface NewsMatchBox {
  sim: SimResult;
  box: BoxSink;
  homeTeamId: string;
  awayTeamId: string;
  homeSquad: Player[];
  awaySquad: Player[];
  homeName: string;
  awayName: string;
  homeDv: number;
  awayDv: number;
}

// 플옵 ref 파싱 — 경기별('po:g'·'final:g', g는 숫자)만 허용. 시리즈 refs('po:clinch' 등)·형식 오류는 null.
function parsePlayoffRef(ref: string | undefined): { round: PoRound; g: number } | null {
  if (!ref) return null;
  const parts = ref.split(':');
  if (parts.length !== 2) return null;
  const [round, gStr] = parts;
  if (round !== 'po' && round !== 'final') return null;
  if (!/^\d+$/.test(gStr)) return null; // 'clinch' 등 비숫자 g 배제
  return { round, g: Number(gStr) };
}

export function newsMatchBox(n: NewsItem): NewsMatchBox | null {
  if (n.kind === 'match' || n.kind === 'debut') {
    // 정규시즌 경기 — (dayIndex, teamId)로 fixture 유일 식별(라운드로빈에선 팀당 하루 1경기).
    if (n.day == null || !n.teamId) return null;
    const cand = SEASON.filter((f) => f.dayIndex === n.day && (f.homeTeamId === n.teamId || f.awayTeamId === n.teamId));
    if (cand.length !== 1) return null; // 유일성 가드 — 0건(소재 없음)·2건 이상(지어내기 금지) 모두 미표시
    const f = cand[0];
    const { homeSquad, awaySquad, sim, box } = buildMatchBox(f.homeTeamId, f.awayTeamId, f.dayIndex, f.seed, interventionsFor(f.id));
    return {
      sim, box, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, homeSquad, awaySquad,
      homeName: getTeam(f.homeTeamId)?.name ?? '', awayName: getTeam(f.awayTeamId)?.name ?? '',
      homeDv: coachInfoOf(f.homeTeamId)?.dvPhilosophy ?? 0, awayDv: coachInfoOf(f.awayTeamId)?.dvPhilosophy ?? 0,
    };
  }

  if (n.kind === 'playoff') {
    // 플옵 경기는 SEASON에 없다 → 정규 경로로 찾으면 안 됨(별 경로 buildPlayoffBox). 경기별 ref만.
    const parsed = parsePlayoffRef(n.ref);
    if (!parsed) return null; // 'po:clinch'(시리즈)·형식오류 배제
    // buildPlayoffs로 대진(hi=홈·lo=원정) 식별 — buildPlayoffBox에 재사용(중복 계산 회피). playoff 뉴스는 현재 시즌만.
    const pp = buildPlayoffs(n.season);
    const m = parsed.round === 'po' ? pp.po : pp.final;
    if (!m) return null; // 그 라운드 시리즈 없음(진출 팀 부족 등)
    const pb = buildPlayoffBox(n.season, parsed.round, parsed.g, pp); // hi=홈. box는 series.games[g]와 세트 일치(가드).
    return {
      sim: pb.sim, box: pb.box, homeTeamId: m.hiId, awayTeamId: m.loId,
      homeSquad: pb.homeSquad, awaySquad: pb.awaySquad,
      homeName: getTeam(m.hiId)?.name ?? '', awayName: getTeam(m.loId)?.name ?? '',
      homeDv: coachInfoOf(m.hiId)?.dvPhilosophy ?? 0, awayDv: coachInfoOf(m.loId)?.dvPhilosophy ?? 0,
    };
  }

  return null;
}
