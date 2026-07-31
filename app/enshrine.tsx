// 명예의전당 헌액 화면 — 오프시즌 뒷단 허브(일정 탭 §5.6.5)에서 `/enshrine?hub=1`로만 진입.
// 이번 시즌 새 레전드를 유니폼 + 헌액 번호 일러스트로 기린다(관전형 1순위 — 보는 경험).
// 정정(2026-07-31 사용자 결정 — 뒷단 체인 완전 폐지): 옛 체인(season-start→헌액→전지훈련→개막 브리지)을
//   없애 이 화면은 항상 허브 진입이다. done()은 항상 markEnshrineSeen + 일정 복귀(뒤로가기 자유 — 열람 화면이라 잠글 이유 없음).
// 새 레전드 0명이어도 자동 통과하지 않고 "헌액자 없음" 한 장을 조용히 보여준다(허브·직접 진입 방어용 안전판).
// docs/BROADCAST_SYSTEM §8.4. 번호 계보(사실)는 같은 구단·같은 번호 과거 레전드만 나열(가짜 인과 금지).
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { LegendIllustration } from '../components/LegendIllustration';
import { teamColors } from '../lib/teamColor';
import { shortTeamName } from '../data/league';
import { seasonYear } from '../data/seasonLabel';
import { prospectArcRetro } from '../data/seed';
import { jerseyNumber, SUPER_LEGEND_POINTS } from '../engine/jersey';
import { numberLineage } from '../data/legends';
import { useGameStore } from '../store/useGameStore';
import { useOffseasonExit } from '../components/offseasonExit';

export default function Enshrine() {
  // 항상 허브 진입(§5.6.5 뒷단) — 일정 탭 오프시즌 카드에서 `/enshrine?hub=1`로 연다. 체인 폐지(2026-07-31)로 다른 진입 경로 없음.
  //   done()은 markEnshrineSeen(뒷단 순차 커서 전진) + 일정 복귀. 뒤로가기도 막지 않는다(열람 화면 — 잠글 이유 없음).
  const exit = useOffseasonExit();
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

  // 헌액 완료 → 열람 마커(markEnshrineSeen)를 찍어 뒷단 순차 커서가 헌액→전지훈련으로 전진하게 하고 일정으로 복귀(exit).
  //   뒤로가기(미열람)면 마커 미세팅 → 헌액 스텝 유지(§5.6.5 멱등). 잠금 없음 — 열람 화면이라 자유 이탈(체인 폐지 2026-07-31).
  const markEnshrineSeen = useGameStore((s) => s.markEnshrineSeen);
  const done = () => { markEnshrineSeen(); exit(); };

  // 헌액자 없음 — 조용한 한 장(강제 대기 없이 탭 한 번으로 다음). 스쳐 지나가듯 스킵되지 않게 명시(2026-07-08 사용자 결정).
  if (newLegends.length === 0) {
    return (
      <Screen title={`${seasonYear(season - 1)} 명예의전당`}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyMark}>🏛️</Text>
          <Text style={styles.emptyLead}>이번 시즌 헌액자는 없습니다.</Text>
          <Text style={styles.emptySub}>전당에 새겨질 은퇴 레전드가 나오지 않았습니다.</Text>
        </View>
        <Pressable style={styles.btn} onPress={done}>
          <Text style={styles.btnTxt}>오프시즌 준비로 →</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen title={`${seasonYear(season - 1)} 명예의전당 헌액`}>
      <Text style={styles.lead}>한 시대가 전당에 새겨졌다. {newLegends.length}명의 레전드</Text>
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
                  {num}번 계보, {lineage.map((g) => `${g.name}(${g.points.toLocaleString()}점)`).join(', ')}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      <Pressable style={styles.btn} onPress={done}>
        <Text style={styles.btnTxt}>오프시즌 준비로 →</Text>
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
  emptyWrap: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyMark: { fontSize: 44, marginBottom: 4 },
  emptyLead: { color: '#FFD879', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  emptySub: { color: '#9FB0C4', fontSize: 12.5, textAlign: 'center' },
});

// 라우트 에러 폴백(UI-50 ⑦) — 이 화면이 render throw해도 앱이 죽지 않고 "일정으로 돌아가기" 폴백이 뜬다(소프트락 봉인).
export { ErrorBoundary } from '../components/RouteErrorBoundary';
