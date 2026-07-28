// 오프시즌 허브 출구(SEASON_SYSTEM §5.6 · UI-50) — 앞단 오프시즌 화면은 "다음 단계로 push"가 아니라
// **일정 탭으로 복귀**한다. 시상식(awards-ceremony)·전지훈련이 이미 쓰던 dismissAll 패턴을 공용화한 것.
//
// 왜 dismissAll인가: router.back()은 스택 모양에 의존해, 같은 화면이 여러 장 쌓였거나(중복 진입) 그 화면이
//   스택 루트(프로세스 복원 딥링크)면 "나갔는데 또 나오는" 반복 노출이 된다(training-camp 2026-07-11 사용자 제보).
//   dismissAll이 쌓인 오프시즌 화면을 전부 걷어 탭으로, 걷을 게 없으면(루트) 일정 탭으로 replace.
// 재마운트 회피: dismissAll은 (tabs)를 **언마운트하지 않으므로** 일정 탭의 로딩 게이트(800ms)·무거운 메모가
//   복귀마다 재실행되지 않는다. 이게 허브가 체인보다 싼 이유의 절반이다(§5.6 성능 실측).
//
// 순차 커서 전진(§5.6.4 재재정정 2026-07-28): 앞단 스텝을 **명시적으로 마치고** 이 훅으로 나올 때만 `offseasonStep`을 전진시킨다.
//   뒤로가기(하드웨어/헤더 `router.back`)는 이 훅을 안 타므로 커서 미전진 → 같은 업무 유지(테스터가 "뒤로가기=끝난 걸로 처리" 지적한 것 수정).
//   크래시 통과(소프트락)는 별경로 — `OffseasonRouteErrorBoundary`(components/RouteErrorBoundary)가 담당.
import { useCallback } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { useGameStore } from '../store/useGameStore';
import { preOffseasonSteps } from '../data/offseasonHub';

// 앞단 순차 허브 라우트 → 스텝 인덱스(preOffseasonSteps 순서가 정본). `/draft-live`는 draft(마지막) 스텝의 하위 화면이라 같은 인덱스.
const STEP_INDEX: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  preOffseasonSteps().forEach((s, i) => { m[s.route] = i; });
  if (m['/draft'] !== undefined) m['/draft-live'] = m['/draft']; // 라이브 드래프트 완료 = 드래프트 스텝 완료
  return m;
})();

export function useOffseasonExit(): () => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(() => {
    const idx = STEP_INDEX[pathname];
    if (idx !== undefined) useGameStore.getState().setOffseasonStep(idx + 1); // 이 스텝 명시 완료 → 다음 업무(forward-only)
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/(tabs)/schedule');
  }, [router, pathname]);
}
