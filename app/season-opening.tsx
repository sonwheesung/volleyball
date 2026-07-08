// 개막 브리지 화면 — 오프시즌 체인의 마지막 한 장(전지훈련 → 여기 → 홈). "새 시즌이 시작됩니다."를
// 시즌 연도와 함께 조용히 알린다(2026-07-08 사용자 결정). 강제 대기·타이머 없이 탭 한 번으로 홈(개막) 진입.
// 연출은 구조만 깨끗하게 — 과한 애니메이션 금지(사용자가 곧 시상식 UI·BGM을 직접 손볼 예정).
// 순서: 드래프트 → season-start(확정) → 헌액 → 전지훈련 → [여기: 개막 브리지] → 홈. docs/SEASON_SYSTEM §5.5.
import { useRouter, useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { seasonYear } from '../data/seasonLabel';
import { useGameStore } from '../store/useGameStore';

export default function SeasonOpening() {
  const router = useRouter();
  const season = useGameStore((s) => s.season); // endSeason 후 현재값 = 이제 막 시작하는 새 시즌 인덱스

  // 소비된 오프시즌 스택(playoffs·시상식·트라이아웃·FA·드래프트·헌액·전지훈련)을 전부 비우고 대시보드로.
  //   dismissAll(POP_TO_TOP)로 루트((tabs))까지 pop → replace로 그 자리를 대시보드로 확정(잔재 0 — 뒤로가기/제스처로 앞 단계 재노출 차단).
  const enter = () => { router.dismissAll(); router.replace('/(tabs)'); };

  // 개막 브리지는 되돌릴 수 없다 — 하드웨어 백·제스처·POP 무력화. enter()의 dismissAll/replace(POP_TO_TOP/REPLACE)만 통과.
  const navigation = useNavigation();
  useEffect(() => {
    const onBack = () => true;
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      const t = e?.data?.action?.type;
      if (t === 'GO_BACK' || t === 'POP') e.preventDefault();
    });
    return () => { sub.remove(); unsub(); };
  }, [navigation]);

  return (
    <Screen title="새 시즌 개막">
      <View style={styles.wrap}>
        <Text style={styles.mark}>🏐</Text>
        <Text style={styles.year}>{seasonYear(season)}</Text>
        <Text style={styles.lead}>시즌이 시작됩니다.</Text>
        <Text style={styles.sub}>준비를 마쳤습니다. 코트로 나갈 시간입니다.</Text>
      </View>
      <Pressable style={styles.btn} onPress={enter}>
        <Text style={styles.btnTxt}>개막전으로 →</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 56, gap: 8 },
  mark: { fontSize: 52, marginBottom: 8 },
  year: { color: '#FFD879', fontSize: 34, fontWeight: '900', letterSpacing: 1 },
  lead: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', marginTop: 2 },
  sub: { color: '#9FB0C4', fontSize: 13, textAlign: 'center', marginTop: 6 },
  btn: { marginTop: 16, alignSelf: 'center', backgroundColor: '#FFD879', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 999 },
  btnTxt: { color: '#3A2A08', fontSize: 14, fontWeight: '800' },
});
