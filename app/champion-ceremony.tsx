// 우승팀 시상식 (SEASON_SYSTEM §5.3 세리머니 3단 체인, 2026-07-08) — 결승 종료 후 첫 단계.
//   우승·챔프MVP를 여기서만 수여(중복 금지). ChampionCelebration 오버레이를 흡수·대체. 미니멀(사용자 UI+BGM 개편 예정).
//   내 팀 우승 = 풀 연출(ChampionCelebration), 타 구단 우승 = 짧은 결과 통지(대관식 풀 연출 강제 금지).
//   ★ recordChampion은 **여기 진입 시** 적립(§5.3) — archive[season].championId 존재가 "시상식 봤음" 마커(영속 0 파생)가 되어
//     일정 화면이 "시상식 보러가기"→"시즌 결산"으로 전환한다. endSeason 전이라 시상은 재계산. 다음 → 리그 시상식(awards-ceremony).
import { useEffect, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Loading, Muted, Screen, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { ChampionCelebration } from '../components/ChampionCelebration';
import { getTeam, getPlayer, reconstructForeignName } from '../data/league';
import { currentSeasonAwards } from '../data/awards';
import { AwardPoster } from '../components/AwardPoster';
import { AWARD_TEMPLATES, buildAwardPosterData } from '../data/awardPoster';
import { leagueProduction } from '../data/production';
import { buildPlayoffs } from '../data/playoffs';
import { revealedChampionId } from '../data/postseason';
import { seasonYear } from '../data/seasonLabel';
import { useGameStore } from '../store/useGameStore';

export default function ChampionCeremony() {
  const ready = useDeferredReady();
  if (!ready) return <Loading title="시상식" variant="brand" />;
  return <Inner />;
}

function Inner() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const archive = useGameStore((s) => s.archive);
  const currentDay = useGameStore((s) => s.currentDay);
  const recordChampion = useGameStore((s) => s.recordChampion);

  // 우승팀 — 이미 기록됐으면 archive(재진입·구세이브), 아니면 포스트시즌 컷오프 트랙(결승 확정 후에만 non-null, §5.2).
  const championId = useMemo(() => {
    const recorded = archive.find((a) => a.season === season)?.championId;
    if (recorded) return recorded;
    return revealedChampionId(buildPlayoffs(season), currentDay);
  }, [archive, season, currentDay]);
  // 시상식 진입 = 우승 적립(§5.3 마커 — 일정 화면이 "시즌 결산"으로 전환). 결승 확정 전(null — 딥링크)엔 no-op.
  useEffect(() => {
    if (championId && !archive.some((a) => a.season === season)) recordChampion(season, championId);
  }, [championId, season, archive, recordChampion]);
  const iWon = !!my && championId === my;
  // 챔프MVP — 결승 확정 후라 poDay=MAX(기본)로 공개(§5.2). 우승팀 소속.
  const mvpName = useMemo(() => {
    if (!championId) return undefined;
    const id = currentSeasonAwards(season).finalsMvp?.playerId;
    return id ? (getPlayer(id)?.name ?? reconstructForeignName(id) ?? undefined) : undefined;
  }, [championId, season]);
  const champName = championId ? (getTeam(championId)?.name ?? championId) : '-';
  // 챔프전 MVP 포스터(AWARDS_SYSTEM §8) — 자산·수상자 있을 때만. 리그 시상식과 중복 수여 아님(여기가 유일 수여처 §5.3).
  const finalsPoster = useMemo(() => {
    if (!championId) return null;
    const w = currentSeasonAwards(season).finalsMvp;
    if (!w) return null;
    return buildAwardPosterData(w, season, my ?? null, leagueProduction(Number.MAX_SAFE_INTEGER));
  }, [championId, season, my]);


  const goAwards = () => router.push('/awards-ceremony');

  // 포스터 본문(자산+우리 구단 태그) — 미우승/우승 분기가 공유(중복 렌더 방지).
  const posterBody = finalsPoster ? (
    <>
      <AwardPoster
        template={AWARD_TEMPLATES.finalsMvp.src}
        tone={AWARD_TEMPLATES.finalsMvp.tone}
        seasonLabel={finalsPoster.seasonLabel}
        name={finalsPoster.name}
        posEn={finalsPoster.posEn}
        ovr={finalsPoster.ovr}
        stats={finalsPoster.stats}
        emblem={finalsPoster.emblem}
      />
      {finalsPoster.isMine ? <Muted style={{ color: theme.accent, fontWeight: '800' }}>우리 구단의 챔프전 MVP</Muted> : null}
    </>
  ) : null;

  return (
    <Screen>
      {iWon ? (
        <ChampionCelebration teamName={champName} teamId={my!} season={season} mvpName={mvpName} onDone={goAwards} />
      ) : !finalsPoster ? (
        // 미우승 폴백 — 챔프MVP 미확정(finalsPoster null, 엣지)일 때만 기존 챔피언 통지 카드를 남겨 화면이 비지 않게 한다.
        // 포스터가 있는 정상 경로는 상단 카드를 제거하고(2026-07-22 사용자 지시) 포스터가 화면의 주인공이 된다(아래 블록).
        // 이 카드는 엣지 폴백이라 진입 버튼을 그대로 둔다(탭 통일 대상 아님 — 2026-07-22 사용자 지시).
        // 챔피언 팀명은 일정(시상식 마커)·시즌 결산에서 확인 가능 — 2026-07-22 사용자 지시.
        <Card accent={theme.gold} flat>
          <IconLabel icon="trophy-outline" color={theme.gold}>{seasonYear(season)} 챔피언</IconLabel>
          <Text style={styles.champ}>🏆 {champName}</Text>
          {mvpName ? <Muted style={{ marginTop: 4 }}>챔프전 MVP · {mvpName}</Muted> : null}
          <View style={{ marginTop: 12 }}>
            <Button label="리그 시상식 →" onPress={goAwards} />
          </View>
        </Card>
      ) : null}
      {finalsPoster ? (
        !iWon ? (
          // 미우승 정상 경로 — awards-ceremony 진행 크롬과 동일 문법: 포스터 영역 전체를 Pressable로 감싸 탭하면 리그 시상식으로.
          // "리그 시상식 →" 버튼 제거하고 탭 방식으로 통일(2026-07-22 사용자 지시). 힌트·stage 스타일은 awards-ceremony와 정합.
          <Pressable onPress={goAwards} style={styles.stage}>
            <Muted style={styles.hint}>화면을 탭해 다음 시상 →</Muted>
            <View style={{ alignItems: 'center', gap: 8 }}>{posterBody}</View>
          </Pressable>
        ) : (
          // iWon 분기 — ChampionCelebration onDone이 시상식으로 이어가므로 탭/힌트 없음(무변경).
          <View style={{ alignItems: 'center', marginTop: 14, gap: 8 }}>{posterBody}</View>
        )
      ) : null}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  champ: { color: theme.text, fontSize: 24, fontWeight: '900', marginTop: 6 },
  // awards-ceremony 진행 크롬과 시각 정합(마진 포함) — stage/hint 동일 값.
  stage: { marginTop: 40, minHeight: 360 },
  hint: { fontSize: 12, textAlign: 'center', marginBottom: 14 },
}));
