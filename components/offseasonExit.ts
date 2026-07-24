// 오프시즌 허브 출구(SEASON_SYSTEM §5.6 · UI-50) — 앞단 오프시즌 화면은 "다음 단계로 push"가 아니라
// **일정 탭으로 복귀**한다. 시상식(awards-ceremony)·전지훈련이 이미 쓰던 dismissAll 패턴을 공용화한 것.
//
// 왜 dismissAll인가: router.back()은 스택 모양에 의존해, 같은 화면이 여러 장 쌓였거나(중복 진입) 그 화면이
//   스택 루트(프로세스 복원 딥링크)면 "나갔는데 또 나오는" 반복 노출이 된다(training-camp 2026-07-11 사용자 제보).
//   dismissAll이 쌓인 오프시즌 화면을 전부 걷어 탭으로, 걷을 게 없으면(루트) 일정 탭으로 replace.
// 재마운트 회피: dismissAll은 (tabs)를 **언마운트하지 않으므로** 일정 탭의 로딩 게이트(800ms)·무거운 메모가
//   복귀마다 재실행되지 않는다. 이게 허브가 체인보다 싼 이유의 절반이다(§5.6 성능 실측).
import { useCallback } from 'react';
import { useRouter } from 'expo-router';

export function useOffseasonExit(): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/(tabs)/schedule');
  }, [router]);
}
