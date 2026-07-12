// 영입/명단 리스트 행 저수준 프리미티브 (Phase 2 컴포넌트화).
// 반복 구조 `[선행슬롯] + [이름 + 서브텍스트] + [후행슬롯]`를 슬롯으로 흡수. 각 사용처가 인라인 재구현하던
// name(text·16·700)·sub(muted·13·marginTop:1) 스타일을 단일 소스로. 구조/픽셀 "이동"만 — 룩 불변.
//
// 사용 패턴:
//  - 카드 행(기본): <PlayerRow leading title sub trailing onPress? /> — 카드 배경+패딩+보더, onPress면 Pressable(누르면 dim).
//  - bare: rowCol 등 카드 래퍼 안의 내부 flex 행(배경/패딩 없음) — <PlayerRow bare .../>.
//  - noDim: onPress가 있어도 눌림 dim 없음(transactions FA 풀 행처럼 원본이 dim 없던 경우).
//  - title/sub는 ReactNode 허용(색 span 등 인라인 중첩 Text). titleStyle로 이름 색 오버라이드(방출 선수=muted).
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from './theme';

export function PlayerRow({
  leading,
  title,
  titleStyle,
  sub,
  trailing,
  onPress,
  accent,
  bare,
  noDim,
}: {
  leading?: ReactNode;
  title: ReactNode;
  titleStyle?: object;
  sub?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  accent?: string;
  /** bare: 카드 래퍼(배경·패딩·보더) 없이 내부 flex 행만 — rowCol 같은 외부 카드 안에서 쓸 때. */
  bare?: boolean;
  /** noDim: onPress가 있어도 눌림 opacity dim을 적용하지 않음(원본이 dim 없던 사용처 재현). */
  noDim?: boolean;
}) {
  const content = (
    <>
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, titleStyle]}>{title}</Text>
        {sub != null ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {trailing}
    </>
  );
  if (bare) return <View style={styles.bare}>{content}</View>;
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.row, accent ? { borderColor: accent } : null, !noDim && pressed && { opacity: 0.7 }]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.row, accent ? { borderColor: accent } : null]}>{content}</View>;
}

const styles = themedStyles(() => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: theme.border,
  },
  bare: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
}));
