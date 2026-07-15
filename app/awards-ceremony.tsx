// 시상식 연출 (AWARDS_SYSTEM §7) — 플레이오프 → [시상식] → 결산. **한 상씩 단독 표시 + 탭하면 다음 상**
// (현재 상 슬라이드 아웃 → 다음 상 슬라이드 인). 사용자 요청(2026-06-30 "한 상씩 음미"). 장기 피로 완화로 "건너뛰기" 제공.
// endSeason 전이라 currentSeasonAwards로 재계산(새 영속 0). 빈 상은 비트 자동 생략. 가짜 드라마 금지 — 상명+실선수+실스탯만.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Loading, Muted, PosTag, Screen, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { Best7Court } from '../components/Best7Court';
import { AwardIllustration } from '../components/AwardIllustration';
import { LegendIllustration } from '../components/LegendIllustration';
import { currentSeasonAwards } from '../data/awards';
import { getPlayer, shortTeamName, reconstructForeignName } from '../data/league';
import { seasonYear } from '../data/seasonLabel';
import { emblemFor } from '../data/emblems';
import { teamColors } from '../lib/teamColor';
import { jerseyNumber } from '../engine/jersey';
import { useGameStore } from '../store/useGameStore';
import type { AwardWinner } from '../types';

const AnimView = Animated.View;

export default function AwardsCeremony() {
  const ready = useDeferredReady(); // currentSeasonAwards(leagueProduction 풀시즌)이 무거움 — 로딩부터(결산과 동일)
  const router = useRouter();
  const season = useGameStore((s) => s.season);
  const archive = useGameStore((s) => s.archive);
  // 스포일러 이중 가드(UV-10): 이번 시즌 챔피언 미공개(archive[season].championId 미기록) 상태의 딥링크는 풀시즌 시상(MAX) 차단.
  //   정상 플로우(champion-ceremony→awards)에선 recordChampion이 이미 championId를 박아 통과 — schedule championRevealed 게이트·recap-detail 독립 라우트 가드와 동결.
  const championRevealed = archive.some((a) => a.season === season && !!a.championId);
  if (!ready) return <Loading title="시상식" variant="brand" message="시상식 준비 중…" />;
  if (!championRevealed) {
    return (
      <Screen title="시상식">
        <Card flat>
          <Muted style={{ textAlign: 'center', marginTop: 20 }}>
            아직 이번 시즌 챔피언이 가려지지 않았습니다.{'\n'}포스트시즌이 끝난 뒤 시상식이 열립니다.
          </Muted>
        </Card>
        <Button label="나가기" onPress={() => router.back()} />
      </Screen>
    );
  }
  return <CeremonyInner />;
}

function CeremonyInner() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const aw = useMemo(() => currentSeasonAwards(season), [season]);

  const pName = (id: string) => getPlayer(id)?.name ?? reconstructForeignName(id) ?? id;
  const isMine = (w?: AwardWinner | null) => !!w && !!my && w.teamId === my;

  // 공개 비트(빈 상 생략) — 신인 → 기량발전 → 베스트7 → 챔프MVP → 정규MVP(클라이맥스)
  const beats = useMemo(() => {
    const out: { key: string; el: React.ReactNode }[] = [];
    const winnerCard = (icon: React.ComponentProps<typeof IconLabel>['icon'], label: string, w: AwardWinner, suffix = '', climax = false, growth = false) => {
      const c = teamColors(w.teamId);
      const pos = getPlayer(w.playerId)?.position;
      const num = jerseyNumber(w.playerId);
      const figW = climax ? 132 : 104;
      return (
        <Card accent={theme.gold} flat>
          {climax ? <View style={{ alignItems: 'center' }}><AwardIllustration width={150} /></View> : null}
          <IconLabel icon={icon} color={theme.gold}>{label}</IconLabel>
          {/* 선수 실루엣(구단색 유니폼+번호) + 구단 엠블럼 배지 — "어느 팀 선수"를 한눈에(A1) */}
          <View style={styles.figureWrap}>
            <LegendIllustration primary={c.primary} light={c.light} num={num} width={figW} />
            <Image source={emblemFor(w.teamId)} style={styles.emblemBadge} />
          </View>
          <Text style={[styles.win, climax && styles.climax, isMine(w) && { color: theme.accent }]} numberOfLines={1}>
            {pName(w.playerId)}
          </Text>
          <View style={styles.metaRow}>
            {pos ? <PosTag pos={pos} /> : null}
            <Text style={styles.team}>{shortTeamName(w.teamId)}</Text>
            {isMine(w) ? <Text style={styles.mineTag}>우리 구단</Text> : null}
          </View>
          {/* 기량발전상은 OVR 상승폭 → 'OVR' 대신 성장 화살표 ▲N(초록). 나머지는 기록값+접미사 */}
          {growth
            ? <Text style={{ fontSize: 13, textAlign: 'center', marginTop: 4, color: theme.good, fontWeight: '800' }}>▲{w.value}</Text>
            : <Muted style={{ fontSize: 13, textAlign: 'center', marginTop: 4 }}>{w.value}{suffix}</Muted>}
        </Card>
      );
    };
    if (aw.rookie) out.push({ key: 'rookie', el: winnerCard('sparkles-outline', '신인상', aw.rookie) });
    if (aw.mostImproved) out.push({ key: 'improved', el: winnerCard('trending-up-outline', '기량발전상', aw.mostImproved, '', false, true) });
    if (aw.best7.some((s) => s.winner)) {
      out.push({ key: 'best7', el: (
        <>
          <IconLabel icon="trophy-outline" color={theme.gold}>베스트7</IconLabel>
          <Best7Court best7={aw.best7} myTeamId={my ?? null} nameOf={pName} />
        </>
      ) });
    }
    // 챔프전 MVP는 champion-ceremony(우승팀 시상식)에서만 수여(중복 금지, §5.3). 여기선 제외.
    if (aw.mvp) out.push({ key: 'mvp', el: winnerCard('ribbon-outline', '정규리그 MVP', aw.mvp, '', true) });
    return out;
  }, [aw, my]);

  const [idx, setIdx] = useState(0);
  const t = useRef(new Animated.Value(0)).current; // 0=숨김 1=표시
  const last = beats.length - 1;
  const onLast = idx >= last;

  // 비트가 바뀔 때마다 슬라이드 인
  useEffect(() => {
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 380, useNativeDriver: true }).start();
  }, [idx, t]);

  // §5.3 세리머니 체인(2026-07-08): 시상식이 끝나면 **일정 화면으로 복귀** — 일정이 "시즌 결산" 버튼을 노출(마커=archive.championId).
  const goRecap = () => { router.dismissAll(); router.replace('/(tabs)/schedule'); };
  const next = () => {
    if (onLast) return; // 마지막은 버튼으로 진행(클라이맥스 음미)
    Animated.timing(t, { toValue: 0, duration: 170, useNativeDriver: true }).start(() => setIdx((i) => Math.min(i + 1, last)));
  };

  if (beats.length === 0) {
    return (
      <Screen title={`${seasonYear(season)} 시상식`}>
        <Muted style={{ textAlign: 'center', marginTop: 40 }}>이번 시즌 시상 내역이 없습니다.</Muted>
        <Button label="일정으로 돌아가기 →" onPress={goRecap} />
      </Screen>
    );
  }

  return (
    <Screen title={`${seasonYear(season)} 시상식`}>
      {/* 진행 표시 + 건너뛰기 */}
      <View style={styles.topRow}>
        <View style={styles.dots}>
          {beats.map((b, i) => (
            <View key={b.key} style={[styles.dot, i === idx && styles.dotOn, i < idx && styles.dotPast]} />
          ))}
        </View>
        {!onLast ? (
          <Pressable onPress={goRecap} hitSlop={10}><Text style={styles.skip}>건너뛰기 →</Text></Pressable>
        ) : <View />}
      </View>

      {/* 한 상씩 — 탭하면 다음 */}
      <Pressable onPress={next} style={styles.stage}>
        <Muted style={styles.hint}>{onLast ? '한 시즌의 영예' : '화면을 탭해 다음 시상 →'}</Muted>
        <AnimView style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          {beats[idx].el}
        </AnimView>
      </Pressable>

      {onLast ? <Button label="일정으로 돌아가기 →" onPress={goRecap} /> : null}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  dots: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.border },
  dotOn: { backgroundColor: theme.gold, width: 9, height: 9, borderRadius: 5 },
  dotPast: { backgroundColor: theme.muted },
  skip: { color: theme.muted, fontSize: 13, fontWeight: '700' },
  stage: { marginTop: 40, minHeight: 360 },
  hint: { fontSize: 12, textAlign: 'center', marginBottom: 14 },
  win: { color: theme.text, fontSize: 22, fontWeight: '900', marginTop: 4, textAlign: 'center' },
  climax: { fontSize: 28, color: theme.gold },
  figureWrap: { alignSelf: 'center', marginTop: 6, marginBottom: 2 },
  emblemBadge: { position: 'absolute', right: -6, top: -6, width: 38, height: 38, resizeMode: 'contain' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  team: { color: theme.muted, fontSize: 14, fontWeight: '700' },
  mineTag: { color: theme.accent, fontSize: 12, fontWeight: '800' },
}));
