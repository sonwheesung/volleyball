// 확정 픽 무효화 경고 (SEASON_SYSTEM §5.6.3 ④ · UI-50 ⑥).
//
// 상류 레버(FA 오퍼·보호·재계약·외국인/아시아쿼터 결정)를 바꾸면 드래프트 순번(myPickSlots)·클래스 구성이
// 바뀌어 라이브에서 확정한 픽(draftSelections)이 stale이 된다 → 스토어가 clear한다.
// 체인 시절엔 FA→드래프트 단방향이라 "확정 후 되돌아가기"가 불가능했지만, **허브에선 상시 가능**하다.
// 무경고 전삭제는 실버그 → 확정 픽이 1건 이상일 때만 경고하고, **0건이면 조용히 통과**(소음 금지).
//
// showAlert 재사용(새 Modal 금지 — iOS 모달 레이스 #129).
import { showAlert } from './AppDialog';
import { useGameStore } from '../store/useGameStore';
import { needsDraftPickWarning } from '../data/offseasonHub';

/** 확정 픽이 있으면 확인을 받고, 없으면 즉시 실행(동기). */
export function confirmDraftPickReset(onProceed: () => void): void {
  const sel = useGameStore.getState().draftSelections;
  const n = sel.length;
  if (!needsDraftPickWarning(sel)) { onProceed(); return; } // 조용히 통과 — 대부분의 경우
  showAlert(
    '확정한 지명이 취소됩니다',
    `라이브 드래프트에서 이미 ${n}명을 지명했습니다.\n지금 이 결정을 바꾸면 지명 순번과 후보가 달라져, 확정한 지명이 모두 취소됩니다.`,
    [
      { text: '그대로 두기', style: 'cancel' },
      { text: '바꾸고 지명 취소', onPress: onProceed },
    ],
  );
}
