// 음수 다이아 잔액 설명 캡션 (MONETIZATION §11.7, 2026-07-16 결제표면 감사 P2-a).
// 스토어 환불로 잔액이 음수가 될 수 있다(환불 클로백 — BACKEND §13.17 P0-1, balance==Σledger 유지 위해 0 clamp 안 함).
// 그대로 "-700"만 보이면 "다이아 증발" 오인 → 잔액이 **음수일 때만** 한 줄 캡션으로 이유·회복 경로를 안내.
// 4화면(마이페이지·상점·다이아 구매·전지훈련)이 이 컴포넌트 하나만 쓴다(중복 구현 금지 — UI-3 단일 소스).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from './Screen';

/** 잔액이 음수일 때만 렌더하는 설명 캡션. 양수/0이면 null(무표시). style로 여백만 조정. */
export function NegativeBalanceNote({ balance, style }: { balance: number; style?: object }) {
  if (!(balance < 0)) return null; // NaN/양수/0 → 미표시
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.icon}>ℹ️</Text>
      <Text style={styles.text}>스토어 환불로 회수된 내역이 반영된 잔액이에요. 충전·적립으로 채워져요.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: theme.warn + '1A',
    borderWidth: 1,
    borderColor: theme.warn + '33',
  },
  icon: { fontSize: 12.5, lineHeight: 18 },
  text: { flex: 1, color: theme.mutedBright, fontSize: 12.5, lineHeight: 18 },
});
