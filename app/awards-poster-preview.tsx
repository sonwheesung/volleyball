// 시상식 포스터 미리보기 (개발용, AWARDS_SYSTEM §8). DEV_TOOLS 게이트 — 운영 빌드에선 진입 차단.
// 시안(오버레이 좌표·폰트·톤)을 앱 실행 없이 반복 확인하는 디자인 하네스.
// 실제 현재 시즌 MVP가 있으면 그 실데이터로, 없으면(경기 미진행) 레이아웃 점검용 **샘플 데이터**로 렌더한다.
// 샘플은 이 화면 안에서만 쓰는 목업(운영 미노출) — 프로덕션 스탯 표시가 아니라 레이아웃 스트레스 테스트용.
import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Screen, Muted, theme } from '../components/Screen';
import { AwardPoster, type AwardPosterProps } from '../components/AwardPoster';
import { DEV_TOOLS } from '../data/flags';
import { mvpPosterData, POS_EN, AWARD_TEMPLATES } from '../data/awardPoster';
import { emblemFor } from '../data/emblems';
import { useGameStore } from '../store/useGameStore';

// 레이아웃 스트레스 샘플(목업) — 긴 이름·세터(포지션별 5칸)·리베로 케이스로 시안 점검.
const SAMPLES: { title: string; props: Omit<AwardPosterProps, 'template'> }[] = [
  {
    title: '샘플 · OH (긴 이름)',
    props: {
      seasonLabel: '2025-26', name: '알레산드라 페레이라', posEn: POS_EN.OH, ovr: 91,
      stats: [
        { label: '득점', value: '742' }, { label: '공격', value: '598' }, { label: '서브', value: '41' },
        { label: '리시브', value: '512' }, { label: '디그', value: '336' },
      ],
      emblem: emblemFor('t0'),
    },
  },
  {
    title: '샘플 · S (세터 — 세트 대표)',
    props: {
      seasonLabel: '2025-26', name: '김하늘', posEn: POS_EN.S, ovr: 84,
      stats: [
        { label: '득점', value: '58' }, { label: '세트', value: '1204' }, { label: '서브', value: '22' },
        { label: '디그', value: '188' }, { label: '블로킹', value: '19' },
      ],
      emblem: emblemFor('t3'),
    },
  },
];

export default function AwardsPosterPreview() {
  if (!DEV_TOOLS) return <Redirect href="/(tabs)/" />; // 개발용 — 실전 빌드 진입 차단

  const season = useGameStore((s) => s.season);
  const my = useGameStore((s) => s.selectedTeamId);
  const real = mvpPosterData(season, my ?? null);

  return (
    <Screen title="시상식 포스터 미리보기">
      <Muted style={{ marginBottom: 4 }}>개발용 — 오버레이 좌표·폰트·톤 반복 확인. 운영 빌드 자동 숨김.</Muted>

      <View style={styles.block}>
        <Text style={styles.cap}>{real ? `현재 시즌 실 MVP · ${real.posEn}` : '현재 시즌 MVP 없음(경기 미진행) — 아래는 샘플'}</Text>
        {real ? (
          <AwardPoster
            template={AWARD_TEMPLATES.mvp.src} tone={AWARD_TEMPLATES.mvp.tone}
            seasonLabel={real.seasonLabel} name={real.name} posEn={real.posEn}
            ovr={real.ovr} stats={real.stats} emblem={real.emblem}
          />
        ) : null}
      </View>

      <View style={styles.block}>
        <Text style={styles.cap}>샘플 · 챔프전 MVP 템플릿 (FINALS MVP)</Text>
        <AwardPoster
          template={AWARD_TEMPLATES.finalsMvp.src} tone={AWARD_TEMPLATES.finalsMvp.tone}
          seasonLabel="2025-26" name="여미정" posEn={POS_EN.OP} ovr={88}
          stats={[
            { label: '득점', value: '736' }, { label: '공격', value: '660' }, { label: '블로킹', value: '52' },
            { label: '서브', value: '24' }, { label: '디그', value: '356' },
          ]}
          emblem={emblemFor('t1')}
        />
      </View>

      {/* 상별 톤 샘플(AWARDS_SYSTEM §8) — 자산 네온에 맞춘 색 계열 확인 */}
      <View style={styles.block}>
        <Text style={styles.cap}>샘플 · 신인상 (블루 톤)</Text>
        <AwardPoster
          template={AWARD_TEMPLATES.rookie.src} tone={AWARD_TEMPLATES.rookie.tone}
          seasonLabel="2025-26" name="정유진" posEn={POS_EN.OH} ovr={79}
          stats={[
            { label: '득점', value: '388' }, { label: '공격', value: '312' }, { label: '서브', value: '19' },
            { label: '리시브', value: '274' }, { label: '디그', value: '198' },
          ]}
          emblem={emblemFor('t2')}
        />
      </View>

      <View style={styles.block}>
        <Text style={styles.cap}>샘플 · 기량발전상 (오렌지 톤 · footnote ▲6)</Text>
        <AwardPoster
          template={AWARD_TEMPLATES.mostImproved.src} tone={AWARD_TEMPLATES.mostImproved.tone} seasonMode={AWARD_TEMPLATES.mostImproved.seasonMode}
          seasonLabel="2025-26" name="한소희" posEn={POS_EN.MB} ovr={82}
          stats={[
            { label: '득점', value: '421' }, { label: '공격', value: '298' }, { label: '블로킹', value: '78' },
            { label: '서브', value: '26' }, { label: '디그', value: '112' },
          ]}
          emblem={emblemFor('t4')} footnote="OVR ▲6"
        />
      </View>

      <View style={styles.block}>
        <Text style={styles.cap}>샘플 · 기록왕 (실버 톤 · 화면 배선 후속)</Text>
        <AwardPoster
          template={AWARD_TEMPLATES.statLeader.src} tone={AWARD_TEMPLATES.statLeader.tone}
          seasonLabel="2025-26" name="마리아 산토스" posEn={POS_EN.OP} ovr={90} seasonKicker="LEAGUE LEADER"
          stats={[
            { label: '득점', value: '842' }, { label: '공격', value: '712' }, { label: '블로킹', value: '48' },
            { label: '서브', value: '38' }, { label: '디그', value: '301' },
          ]}
          emblem={emblemFor('t5')}
        />
      </View>

      {SAMPLES.map((s) => (
        <View key={s.title} style={styles.block}>
          <Text style={styles.cap}>{s.title}</Text>
          <AwardPoster template={AWARD_TEMPLATES.mvp.src} tone={AWARD_TEMPLATES.mvp.tone} {...s.props} />
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { alignItems: 'center', gap: 8, marginTop: 8 },
  cap: { color: theme.muted, fontSize: 12, fontWeight: '700', alignSelf: 'flex-start' },
});
