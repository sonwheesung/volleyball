// 상점 — IAP 전용 화면(2026-07-01, 마이페이지 상점 섹션 분리). 다이아 구매·광고 제거·월드컵 DLC·구매 복원.
//   dev=시뮬 알림, 운영=스토어 결제→우리 서버 직접 검증(RevenueCat 폐기, BACKEND §5). 정본 MONETIZATION_SYSTEM §4.
import Ionicons from '@expo/vector-icons/Ionicons';
import { type ComponentProps } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Muted, Screen, theme, themedStyles } from '../components/Screen';
import { useGameStore } from '../store/useGameStore';
import { purchase, restorePurchases, skuLabel, type Sku } from '../lib/iap';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function ShopCard({ icon, tint, title, sub, onPress }: { icon: IoniconName; tint: string; title: string; sub: string; onPress: () => void }) {
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

export default function Shop() {
  const diamonds = useGameStore((s) => s.diamonds);

  // 상점 결제 — IAP 추상화(lib/iap). dev는 시뮬 알림, 운영은 스토어 결제→우리 서버 직접 검증(RevenueCat 폐기). throw 없이 결과 반환.
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
    <Screen title="상점">
      {/* 다이아 잔액(맥락) — 적립(광고·업적)·소비(전지훈련)는 마이페이지 다이아 허브에서 */}
      <Card accent={theme.sky}>
        <View style={styles.row}>
          <View style={[styles.iconChip, { backgroundColor: theme.sky + '22' }]}><Text style={{ fontSize: 20 }}>💎</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>다이아 {diamonds.toLocaleString()}</Text>
            <Muted style={{ fontSize: 12.5, marginTop: 1 }}>전지훈련으로 선수 능력을 키웁니다</Muted>
          </View>
        </View>
      </Card>

      <Text style={styles.section}>다이아</Text>
      <ShopCard icon="diamond-outline" tint={theme.sky} title="다이아 구매"
        sub="전지훈련용 — 100개 ₩1,000 · 500개 ₩4,800 (출시 시 결제 연결)"
        onPress={() => Alert.alert('다이아 구매', '결제는 출시 빌드에서 연결됩니다. 지금은 광고·업적으로 다이아를 모을 수 있어요.')} />

      <Text style={styles.section}>아이템</Text>
      <ShopCard icon="remove-circle-outline" tint={theme.rose} title="광고 제거"
        sub="게임 내 모든 광고를 없앱니다"
        onPress={() => buy('remove_ads')} />
      <ShopCard icon="globe-outline" tint={theme.sky} title="월드컵 시즌 구매"
        sub="DLC · 4년마다 국가대표 차출(월드컵)"
        onPress={() => buy('dlc_worldcup')} />

      <Pressable onPress={restore} style={{ alignItems: 'center', paddingVertical: 12 }}>
        <Text style={{ color: theme.muted, fontSize: 13, fontWeight: '700' }}>구매 복원</Text>
      </Pressable>

      <Muted style={{ fontSize: 11.5, textAlign: 'center', marginTop: 6 }}>
        결제·다이아 잔액은 서버(온라인)에서 확인됩니다. 광고·업적으로도 다이아를 모을 수 있어요.
      </Muted>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconChip: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.text, fontSize: 16, fontWeight: '800' },
  arrow: { color: theme.accent, fontSize: 24, fontWeight: '900' },
  section: { color: theme.muted, fontSize: 12, fontWeight: '800', marginTop: 14, marginBottom: 2, marginLeft: 2 },
}));
