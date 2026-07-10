// 드래프트 종료 요약 (UI_RULES DL-8 / ⑤ UX 개선) — 순수·결정론·무저장.
//
// 내 팀 지명을 라운드별로 한눈에(다음 시즌 선수단 구성 확인). 내가 패스한 라운드는 PASS.
//   각 줄 = {round}R  {이름} ({포지션})  {DL-4 등급 라벨}. 지명 0/총 0픽(≈60% 시즌)이면 참관 톤(DL-3, 초라하지 않게).
//
// 라운드 매핑: 내 슬롯은 order에서 라운드 1..DRAFT_ROUNDS 순서로 등장하고, 엔진 패스는 **후반 라운드로 몰린다**
//   (aiShouldPass: round≤2 무조건 지명 + 로스터는 단조 증가·후반 문턱 낮음 → 한 번 패스하면 이후도 패스).
//   따라서 내 실제 지명은 라운드 1..M(=내 픽 수)의 **prefix**, 나머지(M+1..R)는 PASS. sequence만으로 복원 가능.
//   (가드 tools/_dv_draftsummary.ts가 자연 런 수백 회로 prefix 불변식·라운드 완결성을 검증.)
import type { Player, Position } from '../types';
import { DRAFT_ROUNDS, type PickReason } from '../engine/draft';
import { prospectGradeLabel } from './prospectGrade';

type Lookup = (id: string) => Player | undefined;
export interface SeqEntry { teamId: string; playerId: string; reason: PickReason }

export interface DraftSummaryRow {
  round: number;
  pass: boolean;
  playerId?: string;
  name?: string;
  position?: Position;
  grade?: string; // DL-4 라벨 — 내 선수는 입단 후 전부 공개(UI-16)라 확정 등급(reveal=1)
}

export interface DraftSummary { rows: DraftSummaryRow[]; pickCount: number }

/**
 * 내 팀 지명 요약(라운드 1..DRAFT_ROUNDS 완결, PASS 채움).
 * @param sequence resolveDraft가 반환한 픽 순서(실지명만; 패스는 항목 없음).
 * @param myTeam   내 팀 id.
 * @param get      선수 lookup(스냅샷 + 클래스).
 */
export function myDraftSummary(sequence: SeqEntry[], myTeam: string, get: Lookup): DraftSummary {
  const myPicks = sequence.filter((s) => s.teamId === myTeam); // 라운드 순서(엔진 order 순)
  const pickCount = myPicks.length;
  const rows: DraftSummaryRow[] = [];
  for (let r = 1; r <= DRAFT_ROUNDS; r++) {
    const pk = myPicks[r - 1]; // prefix: r번째 라운드 = r번째 내 픽(없으면 패스)
    if (!pk) { rows.push({ round: r, pass: true }); continue; }
    const p = get(pk.playerId);
    rows.push({
      round: r,
      pass: false,
      playerId: pk.playerId,
      name: p?.name,
      position: p?.position,
      grade: p ? prospectGradeLabel(p, 1) : undefined, // 내 선수 = 전부 공개(UI-16)
    });
  }
  return { rows, pickCount };
}
