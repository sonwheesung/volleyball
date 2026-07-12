// 펼침형 선택 행 + 측면 액션 (Phase 2 컴포넌트화).
// 반복 구조: `카드 래퍼 + [탭하면 상세 토글되는 헤더] + [좌측 보더로 구분된 우측 액션(위시/담기/pick)] + [펼침 시 상세]`.
// tryout/asian-tryout/draft가 rowWrap/rowInner/rowTap/(wish|pick)Btn을 거의 동일하게 재구현하던 것을 단일 소스로.
// 구조/픽셀 "이동"만 — 룩 불변. (draft-live는 dims(radius10·padding11/9·action16)가 여러 축에서 달라 원본 유지.)
//
// 헤더는 children으로 그대로 넘긴다(아바타·이름줄·상세 토글 표시 등 사용처별 커스텀은 헤더 안에). 상세 패널은
// 이미 분리된 ForeignResumeDetail/ProspectDetail을 detail 슬롯에. 우측 액션 라벨/색은 action 슬롯으로 흡수.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { theme, themedStyles } from './theme';

export function ExpandableRow({
  children,
  onToggle,
  action,
  onAction,
  actionHitSlop = 8,
  actionMinWidth,
  detail,
  selected,
  selectedStyle,
}: {
  /** 탭 영역(헤더) 내용 — 눌러서 상세 토글. */
  children: ReactNode;
  onToggle: () => void;
  /** 우측 측면 액션 버튼의 내용(라벨/색). */
  action?: ReactNode;
  onAction?: () => void;
  actionHitSlop?: number;
  /** 액션 버튼 최소 폭(기본 60 — tryout/asian). draft=64. */
  actionMinWidth?: number;
  /** 펼침 시 상세 노드(caller가 open ? <Detail/> : null 로 게이트). */
  detail?: ReactNode;
  /** 선택(위시/담음) 상태 — 래퍼 보더 강조. */
  selected?: boolean;
  /** 선택 룩 오버라이드(기본=warn 보더. draft=accent 보더+틴트 배경). */
  selectedStyle?: object;
}) {
  return (
    <View style={[styles.wrap, selected ? (selectedStyle ?? styles.selected) : null]}>
      <View style={styles.inner}>
        <Pressable onPress={onToggle} style={styles.tap}>
          {children}
        </Pressable>
        {action != null ? (
          <Pressable onPress={onAction} hitSlop={actionHitSlop} style={[styles.action, actionMinWidth != null ? { minWidth: actionMinWidth } : null]}>
            {action}
          </Pressable>
        ) : null}
      </View>
      {detail}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  selected: { borderColor: theme.warn, borderWidth: 1 },
  inner: { flexDirection: 'row', alignItems: 'center' },
  tap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  action: { paddingHorizontal: 14, paddingVertical: 14, borderLeftWidth: 1, borderLeftColor: theme.border, minWidth: 60, alignItems: 'center' },
}));
