// 얼굴 시트 프리워밍 (AVATAR_SYSTEM · UI_RULES UI-45) — 목록 화면 진입 시 첫 디코드 지연으로
// 아바타 자리에 배경 틴트(플레이스홀더)만 2~7초 잔존하는 문제를 없앤다.
//
// 원인: 시트 PNG(1254×1254)를 RN Image가 **처음 마운트할 때** 비트맵 디코드가 무거운 리스트 렌더 뒤로
//   밀려 늦게 끝난다. 한 번 디코드된 시트는 캐시돼 이후(같은/다른 화면) 즉시 표시된다.
// 처방: 화면 마운트와 함께, **이 화면에 뜨는 선수들의 시트만**(전체 34시트 부트 프리로드 금지 — 발열 #122·메모리)
//   오프스크린으로 미리 렌더해 디코드를 선점(워밍)한다. 리스트의 크롭이 마운트될 땐 캐시 히트로 바로 뜬다.
//
// 왜 expo-asset이 아니라 오프스크린 Image인가: 번들 자산은 Expo Go에서 이미 로컬이라 downloadAsync는
//   파일 확보만 할 뿐 **비트맵 디코드를 데우지 못한다**. RN Image 디코드 파이프라인을 실제로 워밍하려면
//   Image를 마운트하는 수밖에 없다(새 네이티브 모듈 0 — 기존 react-native Image).
//
// 결정론·데이터 무관(순수 표시 연출) — 엔진/스토어 무접촉, 시트 배정(faceCell) 불변.
import { memo, useMemo } from 'react';
import { Image, View } from 'react-native';
import { uniqueFaceSheets } from '../data/faceSheets';

/** 표시 대상 선수 id들이 쓸 시트를 오프스크린으로 미리 디코드. size = 목록에서 아바타에 주는 size(크롭과 동일한
 *  디코드 크기로 워밍해 캐시 키를 맞춘다). 리스트/카드보다 **먼저** 렌더되도록 화면 상단에 둔다. */
export const FaceSheetWarmup = memo(function FaceSheetWarmup({ ids, size = 60 }: { ids: string[]; size?: number }) {
  // ids는 매 렌더 새 배열일 수 있어 시그니처로 메모 — 시트 목록이 안 바뀌면 오프스크린 Image가 재마운트(재디코드)되지 않게.
  const sig = ids.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sheets = useMemo(() => uniqueFaceSheets(ids), [sig]);
  if (sheets.length === 0) return null;
  return (
    // 화면 밖(left:-10000)+opacity 0으로 보이지 않되, 뷰는 부착돼 디코드가 발화한다.
    // collapsable=false: Android가 자식 없는 것으로 보고 뷰를 접어 Image 로드를 건너뛰지 않게.
    <View
      style={{ position: 'absolute', left: -10000, top: 0, opacity: 0 }}
      pointerEvents="none"
      collapsable={false}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {sheets.map((s) => (
        // 크롭(PlayerAvatar)과 동일한 디코드 크기(size*cols × size*rows)·resizeMode로 워밍 → 동일 요청·캐시 히트.
        <Image
          key={String(s.src)}
          source={s.src}
          style={{ width: size * s.cols, height: size * s.rows }}
          resizeMode="stretch"
          fadeDuration={0}
        />
      ))}
    </View>
  );
});
