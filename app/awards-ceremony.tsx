// 시상식 연출 (AWARDS_SYSTEM §7) — 플레이오프 → [시상식] → 결산. 자동 시차 페이드인(탭=즉시 완료/스킵), 관전형
// (독립 리뷰: 탭당 공개 아님 — "매 순간 손이 가게" 금지). endSeason 전이라 currentSeasonAwards로 재계산(새 영속 0).
// 빈 상(무챔프/무신인 등)은 비트 자동 생략. 가짜 드라마 금지 — 상명+실선수+실스탯만(없는 인과 서술 안 함).
import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'expo-router';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Loading, Muted, Screen, theme, useDeferredReady } from '../components/Screen';
import { Best7Court } from '../components/Best7Court';
import { AwardIllustration } from '../components/AwardIllustration';
import { currentSeasonAwards } from '../data/awards';
import { getPlayer, shortTeamName } from '../data/league';
import { useGameStore } from '../store/useGameStore';
import type { AwardWinner } from '../types';

const AnimView = Animated.View;
const MAX_BEATS = 5;

export default function AwardsCeremony() {
  const ready = useDeferredReady(); // currentSeasonAwards(leagueProduction 풀시즌)이 무거움 — 로딩부터(결산과 동일)
  if (!ready) return <Loading title="시상식" variant="brand" message="시상식 준비 중…" />;
  return <CeremonyInner />;
}

function CeremonyInner() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const aw = useMemo(() => currentSeasonAwards(season), [season]);

  const pName = (id: string) => getPlayer(id)?.name ?? id;
  const isMine = (w?: AwardWinner | null) => !!w && !!my && w.teamId === my;

  // 공개할 비트(빈 상 생략) — 신인 → 기량발전 → 베스트7 → 챔프MVP → 정규MVP(클라이맥스)
  const beats = useMemo(() => {
    const out: { key: string; el: React.ReactNode }[] = [];
    const winnerCard = (icon: React.ComponentProps<typeof IconLabel>['icon'], label: string, w: AwardWinner, suffix = '', climax = false) => (
      <Card accent={theme.gold}>
        {climax ? <View style={{ alignItems: 'center' }}><AwardIllustration width={150} /></View> : null}
        <IconLabel icon={icon} color={theme.gold}>{label}</IconLabel>
        <Text style={[styles.win, climax && styles.climax, isMine(w) && { color: theme.accent }]} numberOfLines={1}>
          {pName(w.playerId)}
        </Text>
        <Muted style={{ fontSize: 12.5 }}>{shortTeamName(w.teamId)} · {w.value}{suffix}{isMine(w) ? '  · 우리 구단' : ''}</Muted>
      </Card>
    );
    if (aw.rookie) out.push({ key: 'rookie', el: winnerCard('sparkles-outline', '신인상', aw.rookie) });
    if (aw.mostImproved) out.push({ key: 'improved', el: winnerCard('trending-up-outline', '기량발전상', aw.mostImproved, ' OVR') });
    if (aw.best7.some((s) => s.winner)) {
      out.push({ key: 'best7', el: (
        <>
          <IconLabel icon="trophy-outline" color={theme.gold}>베스트7</IconLabel>
          <Best7Court best7={aw.best7} myTeamId={my ?? null} nameOf={pName} />
        </>
      ) });
    }
    if (aw.finalsMvp) out.push({ key: 'finals', el: winnerCard('medal-outline', '챔피언결정전 MVP', aw.finalsMvp) });
    if (aw.mvp) out.push({ key: 'mvp', el: winnerCard('ribbon-outline', '정규리그 MVP', aw.mvp, '', true) });
    return out.slice(0, MAX_BEATS);
  }, [aw, my]);

  // 고정 5개 Animated.Value(훅 안정) — 앞 beats.length개만 사용
  const anims = useRef(Array.from({ length: MAX_BEATS }, () => new Animated.Value(0))).current;
  const runRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const seq = beats.map((_, i) => Animated.timing(anims[i], { toValue: 1, duration: 420, useNativeDriver: true }));
    const run = Animated.stagger(560, seq);
    runRef.current = run;
    run.start();
    return () => run.stop();
  }, [beats, anims]);

  const skip = () => { runRef.current?.stop(); anims.forEach((a) => a.setValue(1)); };

  return (
    <Screen title={`${season + 1}시즌 시상식`}>
      <Pressable onPress={skip}>
        <Muted style={{ fontSize: 12, textAlign: 'center', marginBottom: 4 }}>한 시즌의 영예를 호명합니다 · 화면을 탭하면 바로 표시</Muted>
        {beats.map((b, i) => (
          <AnimView
            key={b.key}
            style={{ opacity: anims[i], transform: [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}
          >
            {b.el}
          </AnimView>
        ))}
      </Pressable>
      <Button label="시즌 결산 →" onPress={() => router.push('/season-recap')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  win: { color: theme.text, fontSize: 20, fontWeight: '900', marginTop: 4 },
  climax: { fontSize: 26, color: theme.gold },
});
