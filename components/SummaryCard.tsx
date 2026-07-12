// 현황/캡 요약 헤더 카드 (Phase 2 컴포넌트화).
// 구조: <Card accent flat><Row><IconLabel icon color>라벨</IconLabel><Text 값/></Row><Muted 캡션/></Card>.
// office/contracts/transactions의 상단 요약 카드가 거의 동일 → 단일 소스. 구조/픽셀 "이동"만 — 룩 불변.
// (staff 진행바형·fa/draft 다행형은 변형이 커서 원본 유지 — 필요 시 children 슬롯으로 확장.)
//
// 값·캡션 스타일 차이(weight 700/800·fontSize·marginTop·조건부 색)는 valueStyle/captionStyle로 흡수.
// 기본 값 스타일 = text·800(transactions 기준). caption 기본 = fontSize 12.
import type { ComponentProps, ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text } from 'react-native';
import { Card, IconLabel, Muted, Row } from './Screen';
import { theme, themedStyles } from './theme';

export function SummaryCard({
  icon,
  color,
  label,
  value,
  valueStyle,
  caption,
  captionStyle,
  accent,
  children,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  color: string;
  label: ReactNode;
  value?: ReactNode;
  valueStyle?: object;
  caption?: ReactNode;
  captionStyle?: object;
  /** 좌측 액센트 바 색(기본 = color). */
  accent?: string;
  children?: ReactNode;
}) {
  return (
    <Card accent={accent ?? color} flat>
      <Row>
        <IconLabel icon={icon} color={color}>{label}</IconLabel>
        {value != null ? <Text style={[styles.value, valueStyle]}>{value}</Text> : null}
      </Row>
      {caption != null ? <Muted style={[styles.caption, captionStyle]}>{caption}</Muted> : null}
      {children}
    </Card>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  value: { color: theme.text, fontWeight: '800' },
  caption: { fontSize: 12 },
}));
