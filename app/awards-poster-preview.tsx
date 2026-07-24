// 시상식 포스터 미리보기 (개발용, AWARDS_SYSTEM §8). DEV_TOOLS 게이트 — 운영 빌드에선 진입 차단.
// 시안(오버레이 좌표·폰트·톤)을 앱 실행 없이 반복 확인하는 디자인 하네스.
// 실제 현재 시즌 MVP가 있으면 그 실데이터로, 없으면(경기 미진행) 레이아웃 점검용 **샘플 데이터**로 렌더한다.
// 샘플은 이 화면 안에서만 쓰는 목업(운영 미노출) — 프로덕션 스탯 표시가 아니라 레이아웃 스트레스 테스트용.
import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Screen, Muted, theme } from '../components/Screen';
import { AwardPoster, type AwardPosterProps } from '../components/AwardPoster';
import { StatLeadersPoster } from '../components/StatLeadersPoster';
import { DEV_TOOLS } from '../data/flags';
import { mvpPosterData, POS_EN, AWARD_TEMPLATES, posterStats, statsWithCategory, STAT_LEADER_META, type StatLeaderCategory } from '../data/awardPoster';
import { emblemFor } from '../data/emblems';
import { useGameStore } from '../store/useGameStore';
import type { Position } from '../types';
import type { ProdLine } from '../engine/production';

// 레이아웃 스트레스 샘플(목업) — 긴 이름·세터(포지션별 5칸)·리베로 케이스로 시안 점검.
const SAMPLES: { title: string; props: Omit<AwardPosterProps, 'template'> }[] = [
  {
    title: '샘플 · OH (긴 이름)',
    props: {
      seasonLabel: '2025-26', name: '알레산드라 페레이라', posEn: POS_EN.OH, teamName: '천안 프리덤', ovr: 91,
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
      seasonLabel: '2025-26', name: '김하늘', posEn: POS_EN.S, teamName: '대전 스파크', ovr: 84,
      stats: [
        { label: '득점', value: '58' }, { label: '세트', value: '1204' }, { label: '서브', value: '22' },
        { label: '디그', value: '188' }, { label: '블로킹', value: '19' },
      ],
      emblem: emblemFor('t3'),
    },
  },
  {
    // 폭 스트레스(§8 팀명 병기): MIDDLE BLOCKER(가장 긴 포지션 영문) + 긴 팀명 조합에서 한 줄 축소(adjustsFontSizeToFit) 확인.
    title: '샘플 · MB (긴 팀명 폭 스트레스 · MIDDLE BLOCKER + 긴 팀명)',
    props: {
      seasonLabel: '2025-26', name: '최정민', posEn: POS_EN.MB, teamName: '수원 스카이라인즈', ovr: 88,
      stats: [
        { label: '득점', value: '421' }, { label: '공격', value: '298' }, { label: '블로킹', value: '96' },
        { label: '서브', value: '26' }, { label: '디그', value: '112' },
      ],
      emblem: emblemFor('t4'),
    },
  },
];

// ── 기록왕 수여 UX 3안 프로토타입 공통 샘플 (AWARDS_SYSTEM §8.1, 2026-07-23) — 이 화면 전용 목업(운영 미노출) ──
// 다관왕 시연: 마리아 산토스(OP·t5)가 득점·공격·서브 3부문 석권(3관왕). 나머지 4부문은 각기 다른 선수·팀·엠블럼.
const SL_PROD: Record<string, ProdLine> = {
  maria:      { matches: 36, points: 842, spikes: 712, backSpikes: 120, blocks: 48, aces: 38, assists: 12,   digs: 90,  receives: 20 },
  hanjiu:     { matches: 36, points: 520, spikes: 360, backSpikes: 0,   blocks: 96, aces: 22, assists: 8,    digs: 70,  receives: 15 },
  osera:      { matches: 36, points: 5,   spikes: 0,   backSpikes: 0,   blocks: 2,  aces: 4,  assists: 40,   digs: 421, receives: 540 },
  kimhaneul:  { matches: 36, points: 60,  spikes: 18,  backSpikes: 0,   blocks: 20, aces: 24, assists: 1288, digs: 190, receives: 55 },
  munseoyeon: { matches: 36, points: 480, spikes: 400, backSpikes: 40,  blocks: 30, aces: 28, assists: 10,   digs: 240, receives: 612 },
};

// 부문별 목업 수상자 — 부문 메타(한글·영문·field·단위·부문왕)는 셀렉터 STAT_LEADER_META 단일 출처 사용(하드코딩 승격).
interface SLSample { cat: StatLeaderCategory; who: keyof typeof SL_PROD; name: string; pos: Position; team: string; teamName: string; ovr: number }
const SL_SAMPLES: SLSample[] = [
  { cat: 'scoring', who: 'maria',      name: '마리아 산토스', pos: 'OP', team: 't5', teamName: '천안 프리덤',    ovr: 90 },
  { cat: 'spike',   who: 'maria',      name: '마리아 산토스', pos: 'OP', team: 't5', teamName: '천안 프리덤',    ovr: 90 },
  { cat: 'block',   who: 'hanjiu',     name: '한지우',        pos: 'MB', team: 't2', teamName: '화성 코메츠',    ovr: 84 },
  { cat: 'serve',   who: 'maria',      name: '마리아 산토스', pos: 'OP', team: 't5', teamName: '천안 프리덤',    ovr: 90 },
  { cat: 'dig',     who: 'osera',      name: '오세라',        pos: 'L',  team: 't4', teamName: '수원 스카이라인', ovr: 82 },
  { cat: 'set',     who: 'kimhaneul',  name: '김하늘',        pos: 'S',  team: 't3', teamName: '대전 스파크',    ovr: 85 },
  { cat: 'receive', who: 'munseoyeon', name: '문서연',        pos: 'OH', team: 't1', teamName: '인천 타이드',    ovr: 86 },
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
            seasonLabel={real.seasonLabel} name={real.name} posEn={real.posEn} teamName={real.teamName} isMyTeam={real.isMine}
            ovr={real.ovr} stats={real.stats} emblem={real.emblem}
          />
        ) : null}
      </View>

      <View style={styles.block}>
        <Text style={styles.cap}>샘플 · 챔프전 MVP 템플릿 (FINALS MVP)</Text>
        <AwardPoster
          template={AWARD_TEMPLATES.finalsMvp.src} tone={AWARD_TEMPLATES.finalsMvp.tone}
          seasonLabel="2025-26" name="여미정" posEn={POS_EN.OP} teamName="인천 타이드" ovr={88}
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
          seasonLabel="2025-26" name="정유진" posEn={POS_EN.OH} teamName="화성 코메츠" ovr={79}
          stats={[
            { label: '득점', value: '388' }, { label: '공격', value: '312' }, { label: '서브', value: '19' },
            { label: '리시브', value: '274' }, { label: '디그', value: '198' },
          ]}
          emblem={emblemFor('t2')}
        />
      </View>

      <View style={styles.block}>
        <Text style={styles.cap}>샘플 · 기량발전상 (오렌지 톤 · footnote 공헌지수 ▲N)</Text>
        <AwardPoster
          template={AWARD_TEMPLATES.mostImproved.src} tone={AWARD_TEMPLATES.mostImproved.tone} seasonMode={AWARD_TEMPLATES.mostImproved.seasonMode}
          seasonLabel="2025-26" name="한소희" posEn={POS_EN.MB} teamName="수원 스카이라인" ovr={82}
          stats={[
            { label: '득점', value: '421' }, { label: '공격', value: '298' }, { label: '블로킹', value: '78' },
            { label: '서브', value: '26' }, { label: '디그', value: '112' },
          ]}
          emblem={emblemFor('t4')} footnote="공헌지수 ▲214"
        />
      </View>

      <View style={styles.block}>
        <Text style={styles.cap}>샘플 · 기록왕 (실버 톤 · 화면 배선 후속)</Text>
        <AwardPoster
          template={AWARD_TEMPLATES.statLeader.src} tone={AWARD_TEMPLATES.statLeader.tone}
          seasonLabel="2025-26" name="마리아 산토스" posEn={POS_EN.OP} teamName="천안 프리덤" ovr={90} seasonKicker="LEAGUE LEADER"
          stats={[
            { label: '득점', value: '842' }, { label: '공격', value: '712' }, { label: '블로킹', value: '48' },
            { label: '서브', value: '38' }, { label: '디그', value: '301' },
          ]}
          emblem={emblemFor('t5')}
        />
      </View>

      {/* 내 팀 수상자 시각 구분 샘플(§8, 2026-07-23) — 팀명 볼드 강조 + "MY TEAM" 칩. 긴 조합(OP + 긴 팀명)으로 칩 폭 스트레스 겸. */}
      <View style={styles.block}>
        <Text style={styles.cap}>샘플 · 내 팀 수상자 (isMyTeam · MY TEAM 칩 + 팀명 강조 · 칩 폭 스트레스)</Text>
        <AwardPoster
          template={AWARD_TEMPLATES.mvp.src} tone={AWARD_TEMPLATES.mvp.tone}
          seasonLabel="2025-26" name="알레산드라 페레이라" posEn={POS_EN.OP} teamName="수원 스카이라인즈" isMyTeam ovr={92}
          stats={[
            { label: '득점', value: '812' }, { label: '공격', value: '690' }, { label: '블로킹', value: '58' },
            { label: '서브', value: '44' }, { label: '디그', value: '301' },
          ]}
          emblem={emblemFor('t1')}
        />
      </View>

      {/* ══ 기록왕 수여 UX 3안 프로토타입 (AWARDS_SYSTEM §8.1) — 실물 렌더 비교용, 1안 선택 후 후속 배선 ══ */}
      <View style={{ marginTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: 12 }}>
        <Text style={[styles.cap, { fontSize: 14, color: theme.text }]}>기록왕 수여 UX 3안 프로토타입 (§8.1)</Text>
        <Muted style={{ marginTop: 2 }}>7부문 리더(마리아 산토스 3관왕) 샘플. 아래 3안 실물을 보고 1안 선택 → 실제 시상식 배선은 후속.</Muted>
      </View>

      {/* [1안] 부문별 7장 — AwardPoster 재사용(silver 톤), 부문 영문 키커 + 한글 부문·수치 footnote */}
      <View style={styles.groupCap}>
        <Text style={[styles.cap, { color: theme.accent }]}>[1안] 부문별 7장 (각 부문 1장 · 스크롤)</Text>
      </View>
      {SL_SAMPLES.map((L) => {
        const meta = STAT_LEADER_META[L.cat];
        const prod = SL_PROD[L.who];
        const value = prod[meta.field] as number;
        return (
          <View key={'opt1-' + L.cat} style={styles.block}>
            <Text style={styles.cap}>{meta.catEn} · {meta.catKo}</Text>
            <AwardPoster
              template={AWARD_TEMPLATES.statLeader.src} tone={AWARD_TEMPLATES.statLeader.tone}
              seasonLabel={meta.king} seasonKicker={`2025-26 · ${meta.catEn}`}
              name={L.name} posEn={POS_EN[L.pos]} teamName={L.teamName} ovr={L.ovr}
              stats={statsWithCategory(L.pos, prod, meta.catKo, meta.field)}
              highlightLabels={[meta.catKo]}
              emblem={emblemFor(L.team)}
              footnote={`시즌 ${value}${meta.unit} · 리그 1위`}
            />
          </View>
        );
      })}

      {/* [2안] 다관왕만 — 2부문+ 석권자만 1장. 단관왕은 포스터 없음(명단 유지) */}
      <View style={styles.groupCap}>
        <Text style={[styles.cap, { color: theme.accent }]}>[2안] 다관왕만 (2부문+ 석권자만 포스터)</Text>
        <Muted style={{ marginTop: 2 }}>3관왕 마리아 산토스만 포스터 1장. 단관왕(블로킹·디그·세트·리시브)은 포스터 없이 현행 명단 유지.</Muted>
      </View>
      <View style={styles.block}>
        <Text style={styles.cap}>TRIPLE CROWN · 득점·공격·서브 3관왕</Text>
        <AwardPoster
          template={AWARD_TEMPLATES.statLeader.src} tone={AWARD_TEMPLATES.statLeader.tone}
          seasonLabel="3관왕" seasonKicker="2025-26 · TRIPLE CROWN"
          name="마리아 산토스" posEn={POS_EN.OP} teamName="천안 프리덤" ovr={90}
          stats={posterStats('OP', SL_PROD.maria)}
          highlightLabels={['득점', '공격', '서브']}
          emblem={emblemFor('t5')}
          footnote="득점 · 공격 · 서브"
        />
      </View>

      {/* [3안] 대표 1장(모아보기) — 신규 StatLeadersPoster: 7부문 리스트 한 장 */}
      <View style={styles.groupCap}>
        <Text style={[styles.cap, { color: theme.accent }]}>[3안] 대표 1장 (모아보기 · 7부문 리스트)</Text>
      </View>
      <View style={styles.block}>
        <Text style={styles.cap}>STAT LEADERS · 7부문 모아보기</Text>
        <StatLeadersPoster
          template={AWARD_TEMPLATES.statLeader.src} tone={AWARD_TEMPLATES.statLeader.tone}
          seasonLabel="2025-26"
          rows={SL_SAMPLES.map((L) => { const m = STAT_LEADER_META[L.cat]; return { catKo: m.catKo, name: L.name, team: L.teamName, value: `${SL_PROD[L.who][m.field]}${m.unit}` }; })}
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
  groupCap: { alignSelf: 'stretch', marginTop: 14 },
});
