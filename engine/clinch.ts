// 플레이오프 진출 확정/탈락/경합 + 매직넘버 — 잔여 일정 수학(보수적 승수 기반).
// 순수 함수·결정론. 스포일러 안전: "가능성"만 계산(미래 시뮬 결과를 쓰지 않음).
//
// cutoff = 상위 N팀 진출(본 리그는 3). 동률은 보수적으로 "위협"으로 취급하므로
// '확정(clinched)'은 세트득실 동률을 따지지 않아도 100% 신뢰할 수 있다(최악의 경우에도 안에 듦).
// '탈락(eliminated)'도 strict 부등호라 신뢰 가능. 그 사이는 '경합(contention)'.

export type ClinchState = 'clinched' | 'eliminated' | 'contention';

export interface ClinchInput {
  teamId: string;
  wins: number;
  remaining: number; // 남은 경기 수
}

export interface ClinchResult {
  teamId: string;
  state: ClinchState;
  magic: number | null; // 확정까지 자력으로 더 이겨야 하는 최소 승수(경합 중 자력 확정 가능 시). 확정=0, 불가=null
  rank: number;         // 현재 순위(승 기준, 1=1위) — 표시용
}

export function clinchStatus(teams: ClinchInput[], cutoff: number): ClinchResult[] {
  const maxW = (t: ClinchInput) => t.wins + t.remaining;
  const minW = (t: ClinchInput) => t.wins;

  // 현재 순위(승 내림차순) — 표시용 근사(동률은 입력 순서 유지)
  const ranked = [...teams].sort((a, b) => b.wins - a.wins);
  const rankOf = (id: string) => ranked.findIndex((t) => t.teamId === id) + 1;

  return teams.map((x) => {
    // 나를 앞지를 수 있는 팀(동률 포함 보수): Y 최대승 >= 나 최소승
    const threats = teams.filter((y) => y.teamId !== x.teamId && maxW(y) >= minW(x)).length;
    // 내가 다 이겨도 확실히 위인 팀: Y 최소승 > 나 최대승
    const guaranteedAbove = teams.filter((y) => y.teamId !== x.teamId && minW(y) > maxW(x)).length;

    let state: ClinchState;
    if (threats < cutoff) state = 'clinched';              // 최악에도 cutoff 안
    else if (guaranteedAbove >= cutoff) state = 'eliminated'; // 최선에도 cutoff 밖
    else state = 'contention';

    let magic: number | null = null;
    if (state === 'clinched') {
      magic = 0;
    } else if (state === 'contention') {
      // 내가 k승 더 하면 확정되는 최소 k(상대 결과는 가정 안 함 = 자력, 보수적 상한)
      for (let k = 1; k <= x.remaining; k++) {
        const floorIfWinK = x.wins + k;
        const thr = teams.filter((y) => y.teamId !== x.teamId && maxW(y) >= floorIfWinK).length;
        if (thr < cutoff) { magic = k; break; }
      }
    }

    return { teamId: x.teamId, state, magic, rank: rankOf(x.teamId) };
  });
}
