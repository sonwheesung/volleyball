// 마이페이지 — 구단주의 개인 허브(2026-06-30 네비 개편, 구 "기록" 탭 대체).
// 핵심 게임플레이(구단·일정·선수단·단장실)와 별개인 "애매한 항목"을 한곳에: 기록·업적·설정·튜토리얼.
// 기록 본문은 무거워 스택 화면(/records-archive)으로 분리 — 여기선 진입점만(허브는 가볍게).
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Muted, Screen, theme } from '../../components/Screen';
import { SpotlightOverlay, SpotlightTarget } from '../../components/Spotlight';
import { useGameStore } from '../../store/useGameStore';
import { purchase, restorePurchases, skuLabel, type Sku } from '../../lib/iap';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function LinkCard({ icon, tint, title, sub, onPress }: { icon: IoniconName; tint: string; title: string; sub: string; onPress: () => void }) {
  return (
    <Card accent={tint} onPress={onPress}>
      <View style={styles.row}>
        <View style={[styles.iconChip, { backgroundColor: tint + '22' }]}>
          <Ionicons name={icon} size={20} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Muted style={{ fontSize: 12.5, marginTop: 1 }}>{sub}</Muted>
        </View>
        <Text style={styles.arrow}>›</Text>
      </View>
    </Card>
  );
}

export default function MyPage() {
  const router = useRouter();
  const replayOnboarding = useGameStore((s) => s.replayOnboarding);
  const resetTips = useGameStore((s) => s.resetTips);
  const version = (Constants.expoConfig?.version as string) ?? '0.1.0';
  // 상점 — IAP 추상화(lib/iap)에 연결. dev는 시뮬 알림, 운영은 RevenueCat. 모든 함수는 throw 없이 결과 반환.
  // MONETIZATION_SYSTEM: 광고 제거(remove_ads)·월드컵 시즌 구매(dlc_worldcup) 2칸 + 구매 복원(필수).
  const buy = async (sku: Sku) => {
    const r = await purchase(sku);
    if (r.ok) Alert.alert('구매 완료', `${skuLabel(sku)}이(가) 적용되었습니다. 감사합니다!`);
    else if (r.reason === 'cancelled') return; // 유저 취소 — 조용히
    else Alert.alert('구매 실패',
      r.reason === 'network' ? '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
      : r.reason === 'unavailable' ? '상품을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
      : '구매를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  };
  const restore = async () => {
    const r = await restorePurchases();
    Alert.alert(r.ok ? '구매 복원' : '복원 실패',
      r.ok ? '구매 내역을 확인했습니다.' : '잠시 후 다시 시도해 주세요(네트워크 확인).');
  };

  return (
    <Screen title="마이페이지">
      <SpotlightTarget id="history-top">
        <LinkCard icon="trophy-outline" tint={theme.gold} title="기록"
          sub="시즌 · 통산 리더보드 · 명예의전당 · 연표"
          onPress={() => router.push('/records-archive')} />
      </SpotlightTarget>

      <SpotlightTarget id="history-ach">
        <LinkCard icon="ribbon-outline" tint={theme.warn} title="업적"
          sub="구단주의 발자취 — 우승 · 시상 · 레전드 · 기록 · 운영"
          onPress={() => router.push('/achievements')} />
      </SpotlightTarget>

      <LinkCard icon="settings-outline" tint={theme.accent} title="설정"
        sub="효과음 · 세이브 관리 · 버전"
        onPress={() => router.push('/settings')} />

      <LinkCard icon="book-outline" tint={theme.violet} title="튜토리얼 다시보기"
        sub="게임 소개 + 화면 안내를 처음부터"
        onPress={() => { replayOnboarding(); resetTips(); router.replace('/onboarding'); }} />

      {/* ── 상점 (MONETIZATION_SYSTEM) — 광고 제거 · 월드컵 시즌 구매. dev=시뮬, 운영=RevenueCat ── */}
      <Text style={styles.section}>상점</Text>
      <LinkCard icon="remove-circle-outline" tint={theme.rose} title="광고 제거"
        sub="게임 내 모든 광고를 없앱니다"
        onPress={() => buy('remove_ads')} />
      <LinkCard icon="globe-outline" tint={theme.sky} title="월드컵 시즌 구매"
        sub="DLC · 4년마다 국가대표 차출(월드컵)"
        onPress={() => buy('dlc_worldcup')} />
      <Pressable onPress={restore} style={{ alignItems: 'center', paddingVertical: 10 }}>
        <Text style={{ color: theme.muted, fontSize: 13, fontWeight: '700' }}>구매 복원</Text>
      </Pressable>

      <Muted style={{ fontSize: 11.5, textAlign: 'center', marginTop: 6 }}>배구명가 v{version}</Muted>
      <SpotlightOverlay screen="tab-mypage" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconChip: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.text, fontSize: 16, fontWeight: '800' },
  arrow: { color: theme.accent, fontSize: 24, fontWeight: '900' },
  section: { color: theme.muted, fontSize: 12, fontWeight: '800', marginTop: 14, marginBottom: 2, marginLeft: 2 },
});
