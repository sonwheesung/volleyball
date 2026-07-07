// 명예의전당 헌액 화면 — 오프시즌 진행 중(드래프트 직후 endSeason 후) 이번 시즌 새 레전드를
// 유니폼 + 헌액 번호 일러스트로 기린다(관전형 1순위 — 보는 경험). 새 레전드 0명이면 즉시 통과.
// docs/BROADCAST_SYSTEM §8.4. 번호 계보(사실)는 같은 구단·같은 번호 과거 레전드만 나열(가짜 인과 금지).
import { useRouter, useNavigation } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { LegendIllustration } from '../components/LegendIllustration';
import { teamColors } from '../lib/teamColor';
import { shortTeamName } from '../data/league';
import { seasonYear } from '../data/seasonLabel';
import { prospectArcRetro } from '../data/seed';
import { jerseyNumber, SUPER_LEGEND_POINTS } from '../engine/jersey';
import { numberLineage } from '../data/legends';
import { useGameStore } from '../store/useGameStore';

export default function Enshrine() {
  const router = useRouter();
  const season = useGameStore((s) => s.season);
  const my = useGameStore((s) => s.selectedTeamId);
  const hallOfFame = useGameStore((s) => s.hallOfFame);

  // endSeason 직후 진입 — 방금 끝난 시즌(season-1)에 헌액된 레전드들(리그 전체, 내 팀 강조)
  const newLegends = useMemo(
    () => hallOfFame
      .filter((h) => h.legend && h.retiredSeason === season - 1)
      .sort((a, b) => Number(b.teamId === my) - Number(a.teamId === my) || b.points - a.points),
    [hallOfFame, season, my],
  );

  // 헌액 완료 → 소비된 오프시즌 스택(playoffs·시상식·트라이아웃·FA·드래프트)을 전부 비우고 새 시즌 대시보드로.
  //   dismissAll(POP_TO_TOP)로 루트((tabs))까지 pop → replace로 그 자리를 대시보드로 확정(잔재 0 — 뒤로가기/제스처로 드래프트 재노출 차단, D).
  const done = () => { router.dismissAll(); router.replace('/(tabs)'); };
  useEffect(() => { if (newLegends.length === 0) done(); }, [newLegends.length]);
  // 헌액 흐름은 되돌릴 수 없다 — 하드웨어 백·제스처·POP 무력화(B). done()의 dismissAll/replace(POP_TO_TOP/REPLACE)만 통과.
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
  if (newLegends.length === 0) return null;

  return (
    <Screen title={`${seasonYear(season - 1)} 명예의전당 헌액`}>
      <Text style={styles.lead}>한 시대가 전당에 새겨졌다 — {newLegends.length}명의 레전드</Text>
      <View style={{ gap: 14 }}>
        {newLegends.map((h) => {
          const num = jerseyNumber(h.id);
          const c = teamColors(h.teamId);
          const isSuper = h.points >= SUPER_LEGEND_POINTS;
          const lineage = numberLineage(hallOfFame, h.teamId, num, h.id, h.retiredSeason);
          const arc = prospectArcRetro(h.id); // 드래프트 출신 레전드의 커리어 유형 회고(대기만성/즉시전력 — 현역 미노출)
          return (
            <View key={h.id} style={[styles.card, { backgroundColor: c.bg }]}>
              <Text style={styles.tier}>{isSuper ? '👑 초레전드 헌액' : '🎖️ 명예의전당 헌액'}{h.teamId === my ? ' · 내 구단' : ''}</Text>
              <LegendIllustration primary={c.primary} light={c.light} num={num} width={150} />
              <Text style={styles.name}>{h.name}</Text>
              <Text style={[styles.sub, { color: c.light }]}>
                {shortTeamName(h.teamId)} · {isSuper ? '초레전드' : '헌액 번호'} {num}번
              </Text>
              <Text style={styles.stat}>{h.seasons}시즌 · 통산 {h.points.toLocaleString()}점</Text>
              {arc ? <Text style={[styles.lineage, { fontStyle: 'italic' }]}>{arc}</Text> : null}
              {lineage.length > 0 ? (
                <Text style={styles.lineage} numberOfLines={2}>
                  {num}번 계보 — {lineage.map((g) => `${g.name}(${g.points.toLocaleString()}점)`).join(', ')}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      <Pressable style={styles.btn} onPress={done}>
        <Text style={styles.btnTxt}>새 시즌으로 →</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { color: '#FFD879', fontSize: 13, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  card: { borderRadius: 22, paddingTop: 14, paddingBottom: 18, alignItems: 'center', overflow: 'hidden' },
  tier: { color: '#FFD879', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 2 },
  name: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', marginTop: 2 },
  sub: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  stat: { color: '#C8D2DE', fontSize: 12, marginTop: 6 },
  lineage: { color: '#9FB0C4', fontSize: 11, marginTop: 8, paddingHorizontal: 18, textAlign: 'center' },
  btn: { marginTop: 16, alignSelf: 'center', backgroundColor: '#FFD879', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 999 },
  btnTxt: { color: '#3A2A08', fontSize: 14, fontWeight: '800' },
});
