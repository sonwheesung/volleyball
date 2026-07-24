// 새 시즌 시작(=endSeason) 단일 진입점 (SEASON_SYSTEM §5.5 D · UI-50 ⑤).
//
// 허브 전환 후 이 문으로 들어오는 화면이 **3개**가 됐다: 드래프트 센터 · 라이브 드래프트 · 일정 탭 허브 카드.
// 화면 로컬 useRef 래치(구 draft.tsx/draft-live.tsx `startingRef`)는 **화면이 다르면 공유되지 않아**
// 광고(showSeasonStartAd)가 두 번 뜰 수 있다 → 래치를 **모듈 레벨**로 올려 진입점 전체가 하나를 공유한다.
//
// ⚠ 최종 방어선은 여기가 아니다: `store.endSeason`이 `planNextAction(...).kind !== 'seasonOver'`면 즉시 return
//   (§6 진행 게이트)이라, 어떤 경로로 두 번 들어와도 **롤오버는 1회**다. 이 래치는 광고 이중 노출·중복 내비
//   방지용 UX 가드다. 이 사실을 여기 못 박아 둔다(누가 게이트를 지우면 시즌 2전진이 부활한다).
// UI-31: 비동기(광고) 트리거라 state로는 같은 프레임 두 번째 탭을 못 막는다 — 동기 래치 + finally 해제 필수.
import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { showSeasonStartAd } from './ads';

let startingLatch = false; // 모듈 레벨 — 진입점(드래프트·라이브·허브)이 서로 달라도 공유

export function useSeasonStartEntry(): { starting: boolean; start: () => Promise<void> } {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const start = useCallback(async () => {
    if (startingLatch) return;
    startingLatch = true;
    setStarting(true);
    try {
      // 광고는 항상 resolve(스킵/실패/오프라인이어도 진행 하드블록 없음). endSeason은 로딩 화면 페인트 후 실행.
      await showSeasonStartAd();
      router.replace('/season-start');
    } finally {
      startingLatch = false; // 광고 실패·미로드·오프라인에도 잠금 해제(UI-31 finally 필수)
      setStarting(false);
    }
  }, [router]);
  return { starting, start };
}
