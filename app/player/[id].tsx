import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { Button, Card, IconLabel, Loading, Muted, OvrBadge, PosTag, Row, Screen, SCREEN_LOADING_MIN_MS, StatBar, theme, themedStyles, useDeferredReady } from '../../components/Screen';
import { BusyOverlay, useBusyRun } from '../../components/BusyOverlay';
import { showAlert } from '../../components/AppDialog';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { seasonYear, seasonYearRange } from '../../data/seasonLabel';
import { discontentNow, TOPIC_SPEECH, TOPIC_BADGE, ARCHETYPE_KO, effectiveArchetypeOf, conditionOf, popularityNow } from '../../data/owner';
import { playerFans } from '../../engine/owner';
import { SEASON_DAYS } from '../../engine/calendar';
import { rosterIdsOnDay, seasonScandals, suspendedOnDay, availableTeamPlayers, teamInjuriesOn } from '../../data/dynamics';
import { SCANDAL_KO } from '../../engine/scandal';
import { CARD_KO, BENCH_REASON_KO, type TalkCard, type BenchReason, type OwnerRejectReason } from '../../engine/owner';
import { ActionSheet } from '../../components/Popup';
import { getEvolvedPlayer, getPlayer, getTeam, shortTeamName as teamShort, currentRosters, teamScoutReveal } from '../../data/league';
import { buildLineup } from '../../engine/lineup';
import { getPlayerProduction } from '../../data/production';
import { displayCutoff } from '../../data/standings';
import { awardHistoryOf } from '../../data/awards';
import { effectiveContract } from '../../data/roster';
import { isFranchise } from '../../engine/cap';
import { overall, overallRaw, displayOvr, fogOvr, REVEAL_PRECISE } from '../../engine/overall';
import { TRAITS } from '../../engine/traits';
import { deriveRatings } from '../../engine/ratings';
import { growthOutlook } from '../../data/growthOutlook';
import { careerGrowthOf } from '../../data/growthReport';
import { contractStatus, formatMoney } from '../../engine/salary';
import { marketVal } from '../../data/awardSalary';
import { useGameStore } from '../../store/useGameStore';
import { relationsOf } from '../../data/relationships';

const STATUS_COLOR = { 저평가: theme.good, 적정: theme.muted, 고평가: theme.bad } as const;

// ── 시안 컴포넌트(2026-06-28 선수 정보 재설계) ──
const polar = (cx: number, cy: number, r: number, i: number, n: number): [number, number] => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
};

/** 종합 스탯 육각 레이더 — 6축 0~100 + 꼭짓점 스탯 라벨(어느 축인지 표시). 좁은 폭(옆 배치)에서 라벨이
 *  안 잘리게 라벨은 가운데 정렬, 폴리곤은 작게 잡아 가장자리에 라벨 여백을 둔다. */
function RadarChart({ values, labels, size = 158 }: { values: number[]; labels?: string[]; size?: number }) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 36, n = values.length;
  const labelR = size / 2 - 13;
  const ring = (f: number) => values.map((_, i) => polar(cx, cy, R * f, i, n).join(',')).join(' ');
  const poly = values.map((v, i) => polar(cx, cy, R * Math.max(0.06, Math.min(1, v / 100)), i, n).join(',')).join(' ');
  return (
    <Svg width={size} height={size}>
      {[0.4, 0.7, 1].map((f, k) => <Polygon key={k} points={ring(f)} fill="none" stroke={theme.border} strokeWidth={1} />)}
      {values.map((_, i) => { const [x, y] = polar(cx, cy, R, i, n); return <Line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={theme.border} strokeWidth={1} />; })}
      <Polygon points={poly} fill={theme.accent + '40'} stroke={theme.accent} strokeWidth={2} />
      {values.map((v, i) => { const [x, y] = polar(cx, cy, R * Math.max(0.06, Math.min(1, v / 100)), i, n); return <Circle key={`d${i}`} cx={x} cy={y} r={2.5} fill={theme.accent} />; })}
      {labels?.map((lb, i) => {
        const [x, y] = polar(cx, cy, labelR, i, n);
        return (
          <SvgText key={`l${i}`} x={x} y={y + 3} fontSize={9.5} fontWeight="700" fill={theme.muted} textAnchor="middle">{lb}</SvgText>
        );
      })}
    </Svg>
  );
}

/** 특성 육각 뱃지 — 긍정=상승 화살표(민트/초록), 부정=하강(코랄) */
function TraitBadge({ good, color }: { good: boolean; color: string }) {
  const s = 44, cx = s / 2, cy = s / 2, r = s / 2 - 2;
  const pts = Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 3; return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`; }).join(' ');
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={s} height={s} style={StyleSheet.absoluteFill}>
        <Polygon points={pts} fill={color + '1A'} stroke={color + '66'} strokeWidth={1.5} />
      </Svg>
      <Ionicons name={good ? 'arrow-up' : 'arrow-down'} size={20} color={color} />
    </View>
  );
}


// 구단주 면담 기능 노출 토글 — 지금은 숨김(테스트 범위 축소, 운영 단계서 재활성 예정). true면 면담 요청 버튼/이력/불만 대화 노출.
const SHOW_OWNER_TALK = false;

// ── [?] 도움말 카피 (엔진 진실 기반, 추정 금지) ──
//   인간관계: RELATIONSHIP_SYSTEM §3(FA offerScore relT·재계약 friendLeave)·§1.1(posRivalry) — 경기 엔진 무파급(KOVO 불변).
//   선수 상태: FORM_SYSTEM(결장 누적 최대 −7%·복귀 5경기 회복)·OWNER_SYSTEM(성격 아키타입·불만 topic).
const REL_HELP =
  '선수끼리의 친분과 앙숙입니다. 코트 위 경기력에는 영향이 없고, 이적·계약을 정하는 "마음"에만 작용합니다.\n\n' +
  '• 친한 사이 — FA 시장에서 친한 동료가 있는 팀에 더 끌립니다(영입 성공 확률↑). 팀에 친한 동료가 남아 있으면 재계약도 잘 받아들이고, 반대로 각별한 동료를 방출하면 동요해 재계약을 거부할 위험이 커집니다.\n\n' +
  '• 라이벌 — 같은 포지션에서 주전을 다투는 껄끄러운 사이입니다. FA 때 라이벌이 있는 팀은 피하려는 경향이 있습니다.\n\n' +
  '관계는 우승·연봉 같은 큰 요인 다음의 "타이브레이커"라 은은하게 작용합니다.';
const STATUS_HELP =
  '• 컨디션(경기감각) — 최근 실전 출전에 따라 오르내립니다. 꾸준히 경기에 나서면 "좋음"을 유지하고, 오래 결장하면 감각이 녹슬어 기량이 최대 7%까지 떨어집니다(주전으로 계속 뛰면 변화 없음). 다시 코트에 서서 대여섯 경기를 뛰면 감각이 돌아옵니다.\n\n' +
  '• 성격 — 이 선수가 무엇을 가장 중시하는지(연봉·우승·출전·연고·팀 충성)입니다. 벤치에 앉히거나 재계약을 논할 때 반응이 성격마다 다릅니다.\n\n' +
  '• 지금 마음 — 순위·출전·연봉·연고를 지금 어떻게 받아들이는지입니다. 불만이 쌓이면 재계약을 거부하거나 이적을 원할 수 있습니다.';

// 건의 거절 사유 문구(OWNER §2.2 ★) — "가장 큰 감점 요인" 파생. coachCall은 결정론이라 "재도전하면 바뀔 것" 호도 금지 워딩.
const BENCH_REJECT: Record<OwnerRejectReason, string> = {
  ace: '에이스를 그렇게 쉽게 뺄 순 없습니다.',
  ability: '대신 넣을 선수와 기량 차가 커서 지금은 무리입니다.',
  conviction: '라인업은 제가 책임집니다. 제 판단을 믿어주십시오.',
  coachCall: '지금은 이대로 가겠습니다.',
  postseason: '포스트시즌 엔트리는 이미 확정됐습니다. 다음 시즌에 반영하겠습니다.',
};
const START_REJECT: Record<OwnerRejectReason, string> = {
  ace: '지금 라인업이 최선입니다.',
  ability: '아직은 현 주전이 더 낫다고 봅니다.',
  conviction: '라인업은 제가 책임집니다. 제 판단을 믿어주십시오.',
  coachCall: '지금은 이대로 가겠습니다.',
  postseason: '포스트시즌 엔트리는 이미 확정됐습니다. 다음 시즌에 반영하겠습니다.',
};

export default function PlayerDetail() {
  // 선수 상세는 무겁다(선수 진화·생산 집계·인기·레이팅 파생). 한 틱 미뤄 로딩부터 그린다.
  const ready = useDeferredReady(SCREEN_LOADING_MIN_MS);
  if (!ready) return <Loading variant="list" />;
  return <PlayerDetailInner />;
}

function PlayerDetailInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentDay = useGameStore((s) => s.currentDay);
  const results = useGameStore((s) => s.results);
  const overrides = useGameStore((s) => s.contractOverrides);
  const archive = useGameStore((s) => s.archive);
  const milestones = useGameStore((s) => s.milestones);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const myTeamId = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const interviews = useGameStore((s) => s.interviews);
  const benchDirectives = useGameStore((s) => s.benchDirectives);
  const requestInterview = useGameStore((s) => s.requestInterview);
  const suggestBench = useGameStore((s) => s.suggestBench);
  const suggestStart = useGameStore((s) => s.suggestStart);
  const unbench = useGameStore((s) => s.unbench);
  // 관전 중(이어보기 대기) 경기가 있으면 건의는 다음 경기부터 반영(OWNER_SYSTEM 2.3) — 수락 알림에 안내
  const matchInProgress = useGameStore((s) => Object.keys(s.watchProgress).length > 0);
  const deferNote = matchInProgress ? '\n\n(관전 중인 경기엔 적용되지 않고 다음 경기부터 반영됩니다.)' : '';
  const talkCooldown = useGameStore((s) => s.talkCooldown);
  const benchCooldown = useGameStore((s) => s.benchCooldown);
  const bonds = useGameStore((s) => s.bonds);
  const released = useGameStore((s) => s.released);
  const campLog = useGameStore((s) => s.campLog); // "입단 후 성장" 누적에서 전지훈련 구매분 차감용
  const [talkAsk, setTalkAsk] = useState(false);
  const [talkResult, setTalkResult] = useState<{ title: string; color: string; msg: string } | null>(null);
  const [benchAsk, setBenchAsk] = useState(false); // 벤치 건의 명분 선택 시트(네이티브 Alert 대신 커스텀 — UI-21)
  const busy = useBusyRun(); // 건의/복귀 = 벤치지시 갱신 → 출전 라인업(buildLineup) 재도출(무거움) → 오버레이 마스킹(UI-27)
  const p = id ? getEvolvedPlayer(id, currentDay) : undefined;
  const inPostseasonNow = currentDay > SEASON_DAYS; // 포스트시즌 동결(SEASON §5.0) — 건의 비활성(엔트리 확정)
  // 시즌 **통계 파생(생산·시장가)** 은 **결과 인지 표시 컷오프**(§3.3 displayCutoff) — 대시보드·기록과 동일 컷오프.
  // 방금 관전한 경기·시즌말 최종일을 포함하고, 시즌 시작 전(cutoff<0)이면 빈 구간/일자<0 가드로 콜드 전 시즌 시뮬을 회피한다.
  const displayDay = displayCutoff(currentDay, results, myTeamId ?? undefined);
  // **출전 상태(부상·정지·명단·role)는 현재(currentDay) 기준** — 선수단(squad)·대시보드와 동일 날짜여야 표기가 일치한다.
  // (2026-07-04 사용자 보고: 부상 첫날 선수단 🚑 인데 상세엔 부상 표기 없음 — 상세만 displayDay라 하루 어긋났음.
  //  부상 span from은 항상 과거 경기서 굴려져 currentDay 사용은 스포일러 아님 — 이미 치른 경기 파생. 생산 통계만 컷오프 유지.)
  const prod = id ? getPlayerProduction(id, displayDay) : undefined;
  const awardHist = id ? awardHistoryOf(archive, id) : [];
  const myMilestones = id ? milestones.filter((m) => m.playerId === id) : [];

  if (!p) {
    // 은퇴/방출 선수(로스터 밖) — getEvolvedPlayer는 undefined다. 통산 리더보드(records)에서 여기로 딥링크되면
    // "존재하지 않는 선수" 막다른 길이었다(F4). 명예의전당(영속) → base playerBase 순으로 폴백해 통산 기록을 읽기전용 열람.
    const hof = hallOfFame.find((h) => h.id === id);
    const base = id ? getPlayer(id) : undefined;
    const c = base?.career;
    if (hof || c) {
      const nm = hof?.name ?? base!.name;
      const pos = hof?.position ?? base!.position;
      const tid = hof?.teamId; // Player(base)에는 팀 필드가 없음 → HOF 있을 때만 소속 표시
      const seasons = hof?.seasons ?? c?.seasons ?? 0;
      const careerStats = ([
        ['통산 득점', hof?.points ?? c?.points ?? 0],
        ['공격 성공', hof?.spikes ?? c?.spikes ?? 0],
        ['블로킹', hof?.blocks ?? c?.blocks ?? 0],
        ['서브 에이스', hof?.aces ?? c?.aces ?? 0],
        ['디그', hof?.digs ?? c?.digs ?? 0],
        ['세트(어시스트)', hof?.assists ?? c?.assists ?? 0],
      ] as [string, number][]).filter(([, v]) => v > 0);
      return (
        <Screen title={nm}>
          <Card accent={theme.gold}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <PosTag pos={pos} />
              <Text style={styles.pName}>{nm}</Text>
              {hof?.legend ? <Text style={{ color: theme.gold, fontSize: 12, fontWeight: '800' }}>헌액 번호</Text> : null}
            </View>
            <Text style={{ color: theme.muted, fontSize: 13, marginTop: 6 }}>
              {(tid ? `${getTeam(tid)?.name ?? teamShort(tid)} · ` : '')}{hof ? '명예의전당' : '은퇴/방출'} · 통산 {seasons}시즌
            </Text>
          </Card>
          <Card accent={theme.accent}>
            <IconLabel icon="stats-chart-outline" color={theme.accent}>통산 기록</IconLabel>
            {careerStats.length === 0 ? (
              <Muted>기록된 통산 성적이 없습니다.</Muted>
            ) : careerStats.map(([label, v]) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                <Text style={{ color: theme.muted, fontSize: 14 }}>{label}</Text>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '800' }}>{v.toLocaleString()}</Text>
              </View>
            ))}
          </Card>
          {hof ? (
            <Card accent={theme.gold}>
              <Muted>{seasonYear(hof.retiredSeason)} 명예의전당 헌액{hof.legend ? ' · 영구결번급' : ''}. 통산 기록은 영원히 보존됩니다.</Muted>
            </Card>
          ) : null}
        </Screen>
      );
    }
    return (
      <Screen title="선수 없음">
        <Muted>존재하지 않는 선수입니다.</Muted>
      </Screen>
    );
  }

  const r = deriveRatings(p);
  const contract = effectiveContract(p, overrides);
  const market = marketVal(p, prod);
  const status = contractStatus(contract.salary, market);
  const pop = popularityNow(p, currentDay, archive);  // 인기(시작 전 day≤0이면 통산만, 한 번만 계산)

  // ── 구단주 레이어 (내 팀 선수만) ──
  const isMine = !!myTeamId && rosterIdsOnDay(myTeamId, currentDay).includes(p.id);
  // "입단 후 성장"(누적) — 내 팀 선수만("내가 키웠다" 서사·타 구단 스카우팅 흐림과 충돌 회피). 이미 진화된 p 재사용(evolveOnDay 재호출 X).
  // 전지훈련 구매분(campLog)은 차감 → 순수(유기적) 성장만. debut 없으면(구세이브·도입 전 선수) undefined. TRAINING §성장리포트 재정정(2026-07-11).
  const careerGrowth = isMine ? careerGrowthOf(p as any, campLog) : undefined;
  const careerUps = careerGrowth ? careerGrowth.statDeltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta) : [];
  // 스카우팅 공개도 — 내 팀 선수는 전부(포텐까지) 보이고, 타 구단 선수는 스카우터 공개도만큼만(흐림). STAFF_SYSTEM
  const reveal = isMine ? 1 : (myTeamId ? teamScoutReveal(myTeamId) : 1);
  const pot = (s: keyof NonNullable<typeof p.potential>): number | undefined => (isMine ? p.potential?.[s] : undefined);
  const moodInfo = isMine && myTeamId ? discontentNow(p, myTeamId, currentDay, overrides) : null;
  const topic = moodInfo?.topic ?? null;
  // 연고 향수(hometown)면 어느 팀을 그리는지 이름으로(사용자 요청 2026-06-30) — "연고 팀에서 뛰고 싶다"(막연)가
  // 아니라 "○○에서 뛰고 싶다"(구체). preferredTeamId(t0~t6)→팀명. 없으면(구세이브) 기존 막연 문구 폴백.
  const homeTeamName = topic === 'hometown' && p.faPref?.preferredTeamId ? teamShort(p.faPref.preferredTeamId) : null;
  const topicBadgeText = topic ? (homeTeamName ? `연고 향수 · ${homeTeamName}` : TOPIC_BADGE[topic]) : '';
  const topicSpeechText = topic ? (homeTeamName ? `"${homeTeamName}에서 뛰는 게 오랜 꿈이었습니다."` : TOPIC_SPEECH[topic]) : '';
  const cond = isMine && myTeamId ? conditionOf(myTeamId, p.id, currentDay) : null;
  const myTalks = interviews.filter((l) => l.playerId === p.id && l.season === season);
  const lastTalkFailed = myTalks.length > 0 && !myTalks[myTalks.length - 1].ok;
  const benched = benchDirectives.some((b) => b.playerId === p.id && b.toDay == null); // 활성 지시만(종결 toDay 제외 — OWNER 2.3 A3)

  // 주전/후보 — 그 팀의 실제 출전 라인업(부상·정지·벤치 제외 = 경기 엔진과 동일)에서 선발 6인+리베로 여부.
  // 구단주가 선발/벤치 건의 여부를 판단하는 핵심 정보(사용자 보고). 결장 사유가 있으면 그걸 우선 표시.
  const teamOfP = (() => { const rs = currentRosters(); for (const t of Object.keys(rs)) if (rs[t].includes(p.id)) return t; return null; })();
  const role: { text: string; color: string } | null = (() => {
    if (!teamOfP) return null;
    const avail = availableTeamPlayers(teamOfP, currentDay); // 현재 출전 가능(선수단·대시보드와 동일 기준)
    if (!avail.some((x) => x.id === p.id)) {
      if (suspendedOnDay(currentDay).has(p.id)) return { text: '출장 정지', color: theme.bad };
      if (teamInjuriesOn(teamOfP, currentDay).some((s) => s.playerId === p.id)) return { text: '부상 결장', color: theme.bad };
      if (benched) return { text: '벤치(감독 지시)', color: theme.warn };
      return { text: '출전 명단 외', color: theme.muted };
    }
    const lu = buildLineup(avail);
    return lu.six.some((x) => x.id === p.id) || lu.libero?.id === p.id
      ? { text: '주전', color: theme.good }
      : { text: '후보', color: theme.muted };
  })();
  // 건의 버튼 활성화 — 주전이면 벤치 건의만, 후보(벤치)면 선발 기용 건의만(사용자 보고).
  // 부상·정지·명단 외는 둘 다 비활성(출전 자체가 불가).
  const isStarter = role?.text === '주전';
  const isCandidate = role?.text === '후보';

  const talkLeft = Math.max(0, (talkCooldown[p.id] ?? 0) - currentDay);   // 재면담까지 남은 일수
  const benchLeft = Math.max(0, (benchCooldown[p.id] ?? 0) - currentDay); // 재건의까지 남은 일수

  // 면담 — 시스템 Alert 대신 앱 테마 커스텀 모달
  const openTalk = () => { if (topic) setTalkAsk(true); };
  const chooseTalk = (card: TalkCard) => {
    const res = requestInterview(p.id, card);
    setTalkAsk(false);
    if (!res.met) setTalkResult({ title: '면담 거절', color: theme.muted, msg: `${p.name}: "…드릴 말씀 없습니다."\n최근 면담이 잦았거나, 지난 면담에 실망한 상태입니다.` });
    else if (res.ok) setTalkResult({ title: '설득 성공 ✓', color: theme.good, msg: `${p.name}: "알겠습니다. 구단주님 말씀, 믿어보겠습니다."` });
    else setTalkResult({ title: '면담 결렬', color: theme.bad, msg: `${p.name}: "…기대했던 제가 어리석었네요."\n마음이 오히려 멀어졌습니다 — 이적 의향이 올랐습니다.` });
  };

  // 건의 결과는 앱 테마 커스텀 모달(talkResult)로 — 네이티브 Alert 금지(UI-21)
  const benchResult = (res: { ok: boolean; reason?: OwnerRejectReason }) => setTalkResult(res.ok
    ? { title: '감독 수락', color: theme.good, msg: `감독: "알겠습니다. 당분간 ${p.name} 선수는 제외하겠습니다."` + deferNote }
    : { title: '감독 거절', color: theme.muted, msg: `감독: "${res.reason ? BENCH_REJECT[res.reason] : '받아들일 수 없습니다.'}"` });
  const openBench = () => setBenchAsk(true);

  return (
    <Screen>
      {/* ── 히어로: 얼굴 포트레이트 + 이름 + 포지션/상태 + OVR + 인기/팬 ── */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={styles.avatar}>
            <PlayerAvatar id={p.id} size={84} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={styles.pName} numberOfLines={1}>{p.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <PosTag pos={p.position} />
              {role ? (
                <View style={{ backgroundColor: role.color + '22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ color: role.color, fontWeight: '800', fontSize: 12 }}>{role.text}</Text>
                </View>
              ) : null}
              {p.isAsianQuota ? <Text style={{ color: theme.elite, fontWeight: '700', fontSize: 12 }}>아시아쿼터{p.nationality ? `·${p.nationality}` : ''}</Text> : p.isForeign ? <Text style={{ color: theme.bad, fontWeight: '700', fontSize: 12 }}>외국인</Text> : null}
              {isFranchise(p) ? <Text style={{ color: theme.warn, fontWeight: '700', fontSize: 12 }}>프랜차이즈</Text> : null}
              {isMine ? (() => {
                // 성장 상태(GPT ③) — 숫자 숨기고 성장 여력만 한 눈에. 내 팀 선수만(포텐 공개).
                const go = growthOutlook(p);
                const c = go.tone === 'near' ? theme.elite : go.tone === 'plateau' ? theme.muted : theme.good;
                const icon = go.tone === 'fast' ? '⚡ ' : go.tone === 'growing' ? '📈 ' : go.tone === 'near' ? '🌟 ' : '';
                return (
                  <View style={{ backgroundColor: c + '22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: c, fontWeight: '800', fontSize: 12 }}>{icon}{go.label}</Text>
                  </View>
                );
              })() : null}
            </View>
            <Muted style={{ fontSize: 13 }}>{p.age}세 · {p.height}cm</Muted>
          </View>
          {isMine || reveal >= REVEAL_PRECISE ? (
            <OvrBadge value={overallRaw(p)} size={62} />
          ) : (
            <View style={styles.fogBadge}>
              <Text style={styles.fogOvrTxt}>{fogOvr(displayOvr(overallRaw(p)), reveal)}</Text>
              <Text style={styles.fogOvrCap}>OVR</Text>
            </View>
          )}
        </View>
        {!isMine && reveal < REVEAL_PRECISE ? (
          <Text style={{ color: theme.warn, fontSize: 12, marginTop: 6 }}>
            🔍 타 구단 — 스카우팅 공개도 {Math.round(reveal * 100)}%. 스카우터를 영입하면 더 선명해집니다.
          </Text>
        ) : null}
        {suspendedOnDay(currentDay).has(p.id) ? ( // 출전 상태는 현재(currentDay) 기준 — role 배지·선수단과 동일(2026-07-04)
          <Text style={{ color: theme.bad, fontWeight: '800', fontSize: 13, marginTop: 6 }}>
            🚫 출장 정지 중 — {SCANDAL_KO[seasonScandals().find((s) => s.playerId === p.id)!.kind]}
          </Text>
        ) : null}
        <View style={styles.divider} />
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 14 }}>🔥 </Text>
          <Text style={{ color: theme.muted, fontSize: 13 }}>인기 <Text style={{ color: theme.text, fontWeight: '800' }}>{pop}</Text></Text>
          <Text style={{ color: theme.muted, fontSize: 13, marginHorizontal: 8 }}>·</Text>
          <Text style={{ color: theme.muted, fontSize: 13 }}>개인 팬 <Text style={{ color: theme.text, fontWeight: '800' }}>{playerFans(pop).toLocaleString()}명</Text></Text>
        </View>
      </Card>

      {p.traits && p.traits.length > 0 ? (
        <>
          <IconLabel icon="sparkles-outline" color={theme.violet}>특성</IconLabel>
          <Card accent={theme.violet}>
            {p.traits.map((t, i) => {
              const d = TRAITS[t];
              const c = d.good ? theme.good : theme.bad;
              return (
                <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, marginTop: i > 0 ? 4 : 0 }}>
                  <TraitBadge good={d.good} color={c} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c, fontWeight: '800', fontSize: 15 }}>{d.good ? '▲' : '▼'} {d.name}</Text>
                    <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>{d.desc}</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      {(() => {
        const rel = relationsOf(p.id, bonds);
        if (!rel.friends.length && !rel.rivals.length) return null;
        // 이번 시즌 방출된 절친 — Phase 3 friendLeave(재계약 거부↑)를 화면으로
        const lostFriends = rel.friends.filter((f) => released.includes(f.id));
        return (
          <>
            <IconLabel icon="people-circle-outline" color={theme.rose} help={() => showAlert('인간관계란?', REL_HELP)}>인간관계</IconLabel>
            <Card accent={theme.rose}>
              {rel.friends.length > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 }}>
                  <View style={{ backgroundColor: theme.good + '22', borderWidth: 1, borderColor: theme.good + '66', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3, minWidth: 54, alignItems: 'center' }}>
                    <Text style={{ color: theme.good, fontWeight: '800', fontSize: 13 }}>친한</Text>
                  </View>
                  <Text style={{ color: theme.text, flex: 1, fontSize: 14 }}>{rel.friends.map((f) => f.name).join(', ')}</Text>
                </View>
              ) : null}
              {rel.rivals.length > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 }}>
                  <View style={{ backgroundColor: theme.bad + '22', borderWidth: 1, borderColor: theme.bad + '66', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3, minWidth: 54, alignItems: 'center' }}>
                    <Text style={{ color: theme.bad, fontWeight: '800', fontSize: 13 }}>라이벌</Text>
                  </View>
                  <Text style={{ color: theme.text, flex: 1, fontSize: 14 }}>{rel.rivals.map((r) => r.name).join(', ')}</Text>
                </View>
              ) : null}
              {isMine && lostFriends.length > 0 ? (
                <Text style={{ color: theme.bad, fontSize: 12, marginTop: 4 }}>
                  💔 각별한 동료 {lostFriends.map((f) => f.name).join(', ')} 방출에 동요 중 — 재계약 거부 위험↑
                </Text>
              ) : null}
            </Card>
          </>
        );
      })()}

      {isMine && cond ? (
        <>
          <IconLabel icon={SHOW_OWNER_TALK ? 'chatbubbles-outline' : 'pulse-outline'} color={theme.rose} help={SHOW_OWNER_TALK ? undefined : () => showAlert('선수 상태란?', STATUS_HELP)}>{SHOW_OWNER_TALK ? '구단주 면담' : '선수 상태'}</IconLabel>
          <Card accent={theme.rose}>
            <Row>
              <Muted>컨디션</Muted>
              <Text style={{ color: cond.color, fontWeight: '800' }}>● {cond.label}</Text>
            </Row>
            {p.faPref ? (
              <>
                <Row>
                  <Muted>성격</Muted>
                  <Text style={{ color: theme.text, fontWeight: '800', fontSize: 13 }}>
                    {ARCHETYPE_KO[effectiveArchetypeOf(p)].emoji} {ARCHETYPE_KO[effectiveArchetypeOf(p)].label}
                  </Text>
                </Row>
                {/* 성격 부가설명은 게임 가이드(선수>성격)로 이동 — 선수 상세는 간결하게(2026-07-03) */}
              </>
            ) : null}
            {moodInfo ? (
              <Row>
                <Muted>지금 마음</Muted>
                <Text style={{ color: moodInfo.mood === 'discontent' ? theme.bad : moodInfo.mood === 'positive' ? theme.good : theme.muted, fontWeight: '800', fontSize: 13 }}>
                  {moodInfo.mood === 'discontent' ? '😟' : moodInfo.mood === 'positive' ? '😊' : '😐'} {homeTeamName ? `연고 향수 — ${homeTeamName} 그리움` : moodInfo.label}
                </Text>
              </Row>
            ) : null}
            {/* 면담 요청/이력/불만 대화는 SHOW_OWNER_TALK로 숨김(운영 단계서 재활성). 컨디션·성격·지금 마음은 상태 정보로 유지. */}
            {SHOW_OWNER_TALK ? (
              <>
                {topic ? (
                  <>
                    <Text style={{ color: theme.bad, fontWeight: '800', marginTop: 4 }}>😟 {topicBadgeText}</Text>
                    <Muted style={{ fontSize: 13 }}>{topicSpeechText}</Muted>
                    {lastTalkFailed ? <Muted style={{ fontSize: 12, color: theme.bad }}>💔 지난 면담이 결렬됐습니다 — 다시 문을 두드리면 거절당할 수 있습니다.</Muted> : null}
                    {talkLeft > 0 ? <Muted style={{ fontSize: 12 }}>⏳ 최근 면담 — 약 {talkLeft}일 뒤 다시 가능합니다.</Muted> : null}
                    <Button label={talkLeft > 0 ? `면담 (${talkLeft}일 후)` : '면담 요청'} onPress={openTalk} disabled={talkLeft > 0} />
                  </>
                ) : (
                  <Muted style={{ marginTop: 4 }}>😊 특별한 불만 없음 — "괜찮습니다, 구단주님."</Muted>
                )}
                {myTalks.length > 0 ? (
                  <View style={{ marginTop: 6, gap: 2 }}>
                    {myTalks.map((l, i) => (
                      <Muted key={i} style={{ fontSize: 12 }}>
                        {l.day}일차 · {TOPIC_BADGE[l.topic]} · "{CARD_KO[l.card]}" → {l.ok ? '성공' : '결렬'}
                      </Muted>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
          </Card>

          <IconLabel icon="clipboard-outline" color={theme.violet}>감독 건의</IconLabel>
          <Card accent={theme.violet}>
            {inPostseasonNow ? (
              // 포스트시즌 동결(SEASON §5.0) — 엔트리는 정규 종료 시점 확정. no-op 건의 금지(스토어도 postseason 사유로 거절).
              <Muted style={{ fontSize: 12 }}>포스트시즌 엔트리 확정 — 건의는 다음 시즌부터 가능합니다.</Muted>
            ) : benched ? (
              <Button label="복귀 지시 (벤치 해제)" onPress={() => showAlert('복귀 지시', `정말 ${p.name} 선수의 복귀를 지시할까요?\n출전 명단에 다시 포함됩니다.`, [
                { text: '취소', style: 'cancel' },
                { text: '복귀 지시', onPress: () => busy.run('감독이 라인업을 다시 그리는 중…', () => { unbench(p.id); setTalkResult({ title: '복귀', color: theme.good, msg: `${p.name} 선수가 출전 명단에 복귀합니다. 실전 감각은 몇 경기에 걸쳐 돌아옵니다.` }); }) },
              ])} />
            ) : (
              <>
                <Muted style={{ fontSize: 12 }}>
                  선발·교체 등 현장 권한은 감독에게 있고, 구단주는 건의만 할 수 있습니다.
                  감독 성향에 따라 거절할 수 있고, 인기 선수를 오래 벤치에 두면 팬들이 분노합니다(기사·관중·예산).
                </Muted>
                {benchLeft > 0 ? <Muted style={{ fontSize: 12 }}>⏳ 최근 건의 — 약 {benchLeft}일 뒤 다시 건의할 수 있습니다.</Muted> : null}
                {/* 상태에 맞는 건의 하나만 노출(사용자 요청 2026-06-30) — 후보면 '선발 기용', 주전이면 '벤치'.
                    둘 다 비활성으로 띄우던 옛 방식 대신 안 맞는 버튼은 숨긴다. 부상·정지·명단 외는 안내만. */}
                {isCandidate ? (
                  <Button
                    label={benchLeft > 0 ? `선발 기용 건의 (${benchLeft}일 후)` : '선발 기용 건의'}
                    disabled={benchLeft > 0}
                    onPress={() => showAlert('선발 기용 건의', `정말 ${p.name} 선수를 선발로 추천할까요?\n감독이 판단해 수락하거나 거절합니다.`, [
                      { text: '취소', style: 'cancel' },
                      { text: '건의', onPress: () => busy.run('감독이 라인업을 다시 그리는 중…', () => {
                        const res = suggestStart(p.id);
                        setTalkResult(res.ok
                          ? { title: '감독 수락', color: theme.good, msg: `감독: "알겠습니다. ${p.name} 선수에게 기회를 주죠."\n(동포지션 주전 한 명이 벤치로 내려갑니다)` + deferNote }
                          : { title: '감독 거절', color: theme.muted, msg: `감독: "${res.reason ? START_REJECT[res.reason] : '지금 라인업이 최선입니다.'}"` });
                      }) },
                    ])}
                  />
                ) : isStarter ? (
                  <Button label={benchLeft > 0 ? `벤치 건의 (${benchLeft}일 후)` : '벤치 건의'} onPress={openBench} disabled={benchLeft > 0} />
                ) : (
                  <Muted style={{ fontSize: 12 }}>지금은 출전할 수 없는 상태(부상·정지·명단 외)라 건의할 수 없습니다.</Muted>
                )}
              </>
            )}
          </Card>
        </>
      ) : null}

      <IconLabel icon="wallet-outline" color={theme.warn}>계약</IconLabel>
      <Card accent={theme.warn}>
        <Row>
          <Muted>연봉</Muted>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
            {formatMoney(contract.salary)}
          </Text>
        </Row>
        <Row>
          <Muted>시장가치</Muted>
          <Text style={{ color: theme.text, fontWeight: '700' }}>{formatMoney(market)}</Text>
        </Row>
        <Row>
          <Muted>잔여 계약</Muted>
          <Text style={{ color: theme.text, fontWeight: '700' }}>{contract.remaining}년</Text>
        </Row>
        <Row>
          <Muted>평가</Muted>
          <Text style={{ color: STATUS_COLOR[status], fontWeight: '800' }}>{status}</Text>
        </Row>
      </Card>

      {prod && prod.matches > 0 ? (
        <>
          <IconLabel icon="stats-chart-outline" color={theme.elite}>이번 시즌 기록</IconLabel>
          <Card accent={theme.elite}>
            <Row>
              <Muted>경기</Muted>
              <Text style={{ color: theme.text, fontWeight: '700' }}>{prod.matches}경기</Text>
            </Row>
            <Row>
              <Muted>득점</Muted>
              <Text style={{ color: theme.text, fontWeight: '700' }}>
                {prod.points}점 (스{prod.spikes}·블{prod.blocks}·서{prod.aces})
              </Text>
            </Row>
            {p.position === 'S' || prod.assists > 0 ? (
              <Row>
                <Muted>세트</Muted>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{prod.assists}</Text>
              </Row>
            ) : null}
            {p.position === 'L' || prod.digs > 0 ? (
              <Row>
                <Muted>디그</Muted>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{prod.digs}</Text>
              </Row>
            ) : null}
          </Card>
        </>
      ) : null}

      {p.career.matches > 0 ? (
        <>
          {/* 시즌 표기는 연도(EC-REC-01, 2026-07-04 사용자 결정) — career.seasons(시드 백스토리 포함)가 아니라 실제 뛴 인게임 시즌 범위. 구세이브(seasonLines 없음)만 카운트 폴백. */}
          <IconLabel icon="trophy-outline" color={theme.gold}>
            통산 기록{p.seasonLines && p.seasonLines.length > 0 ? ` · ${seasonYearRange(p.seasonLines[0].season, p.seasonLines[p.seasonLines.length - 1].season)}` : ` (${p.career.seasons}시즌)`}
          </IconLabel>
          <Card accent={theme.gold}>
            <Row>
              <Muted>경기</Muted>
              <Text style={{ color: theme.text, fontWeight: '700' }}>{p.career.matches}경기</Text>
            </Row>
            <Row>
              <Muted>득점</Muted>
              <Text style={{ color: theme.text, fontWeight: '700' }}>
                {p.career.points}점 (스{p.career.spikes}·블{p.career.blocks}·서{p.career.aces})
              </Text>
            </Row>
            {(p.career.assists ?? 0) > 0 ? (
              <Row>
                <Muted>세트</Muted>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{p.career.assists}</Text>
              </Row>
            ) : null}
            {p.career.digs > 0 ? (
              <Row>
                <Muted>디그</Muted>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{p.career.digs}</Text>
              </Row>
            ) : null}
          </Card>
        </>
      ) : null}

      {p.seasonLines && p.seasonLines.length > 0 ? (
        <>
          <IconLabel icon="stats-chart-outline" color={theme.elite}>시즌별 기록</IconLabel>
          <Card accent={theme.elite}>
            {p.seasonLines.slice().reverse().map((l) => (
              <View key={l.season} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <Text style={{ color: theme.muted, fontSize: 12, width: 72 }}>{seasonYear(l.season)}</Text>
                <Text style={{ color: theme.muted, fontSize: 12, width: 52 }} numberOfLines={1}>{teamShort(l.teamId)}</Text>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', flex: 1 }}>
                  {l.matches}경기 · {l.points}점
                  {l.assists > 0 ? ` · 세트${l.assists}` : ''}
                  {l.digs > 0 ? ` · 디그${l.digs}` : ''}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {awardHist.length > 0 ? (
        <>
          <IconLabel icon="ribbon-outline" color={theme.gold}>수상 이력</IconLabel>
          <Card accent={theme.gold}>
            {awardHist.map((a, i) => (
              <View key={`${a.season}-${a.label}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <Text style={{ color: theme.muted, fontSize: 12, width: 72 }}>{seasonYear(a.season)}</Text>
                <Text style={{ color: theme.warn, fontSize: 13, fontWeight: '800' }}>🏆 {a.label}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {myMilestones.length > 0 ? (
        <>
          <IconLabel icon="trophy-outline" color={theme.gold}>마일스톤</IconLabel>
          <Card accent={theme.gold}>
            {myMilestones.slice(-8).reverse().map((m, i) => (
              <View key={`${m.season}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <Text style={{ color: theme.muted, fontSize: 12, width: 72 }}>{seasonYear(m.season)}</Text>
                <Text style={{ color: m.big ? theme.warn : theme.text, fontSize: 13, flex: 1 }}>{m.text}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <IconLabel icon="stats-chart-outline" color={theme.elite}>종합 스탯</IconLabel>
      <Card accent={theme.elite}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <RadarChart
            values={[r.spike, r.block, r.dig, r.receive, r.set, r.serve]}
            labels={['스파이크', '블로킹', '디그', '리시브', '세팅', '서브']}
            size={158}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <StatBar label="스파이크" value={r.spike} reveal={reveal} />
            <StatBar label="블로킹" value={r.block} reveal={reveal} />
            <StatBar label="디그" value={r.dig} reveal={reveal} />
            <StatBar label="리시브" value={r.receive} reveal={reveal} />
            <StatBar label="세팅" value={r.set} reveal={reveal} />
            <StatBar label="서브" value={r.serve} reveal={reveal} />
          </View>
        </View>
      </Card>

      <IconLabel icon="barbell-outline" color={theme.elite}>세부 스탯 (밑단)</IconLabel>
      <Card accent={theme.elite}>
        <Muted style={{ marginBottom: 2 }}>신체</Muted>
        <StatBar label="점프력" value={p.jump} reveal={reveal} potential={pot('jump')} />
        <StatBar label="민첩성" value={p.agility} reveal={reveal} potential={pot('agility')} />
        <StatBar label="체력" value={p.staminaMax} reveal={reveal} potential={pot('staminaMax')} />
        <StatBar label="체력재생" value={p.staminaRegen} reveal={reveal} potential={pot('staminaRegen')} />
        <View style={{ height: 6 }} />
        <Muted style={{ marginBottom: 2 }}>공통 / 멘탈</Muted>
        <StatBar label="반응속도" value={p.reaction} reveal={reveal} potential={pot('reaction')} />
        <StatBar label="위치선정" value={p.positioning} reveal={reveal} potential={pot('positioning')} />
        <StatBar label="집중력" value={p.focus} reveal={reveal} potential={pot('focus')} />
        <StatBar label="기복" value={p.consistency} reveal={reveal} potential={pot('consistency')} />
        <StatBar label="VQ" value={p.vq} reveal={reveal} potential={pot('vq')} />
      </Card>

      <IconLabel icon="trending-up-outline" color={theme.good}>기술치</IconLabel>
      <Card accent={theme.good}>
        <StatBar label="공격기술" value={p.skSpike} reveal={reveal} potential={pot('skSpike')} />
        <StatBar label="블로킹기술" value={p.skBlock} reveal={reveal} potential={pot('skBlock')} />
        <StatBar label="디그기술" value={p.skDig} reveal={reveal} potential={pot('skDig')} />
        <StatBar label="리시브기술" value={p.skReceive} reveal={reveal} potential={pot('skReceive')} />
        <StatBar label="세팅기술" value={p.skSet} reveal={reveal} potential={pot('skSet')} />
        <StatBar label="서브기술" value={p.skServe} reveal={reveal} potential={pot('skServe')} />
      </Card>

      {/* 입단 후 성장 — 내 팀 선수만, 상승 스탯만 ▲N(전지훈련 제외 = 순수 성장). 상승 0이면 섹션 숨김. TRAINING §성장리포트(2026-07-11 재정정) */}
      {isMine && careerUps.length > 0 ? (
        <>
          <IconLabel icon="trending-up-outline" color={theme.good}>입단 후 성장 (전지훈련 제외)</IconLabel>
          <Card accent={theme.good}>
            <View style={styles.growWrap}>
              {careerUps.map((d) => (
                <View key={d.label} style={styles.growCell}>
                  <Text style={styles.growName} numberOfLines={1}>{d.label}</Text>
                  <Text style={styles.growDelta}>▲{d.delta}</Text>
                </View>
              ))}
            </View>
          </Card>
        </>
      ) : null}

      {/* 벤치 건의 명분 선택 — 커스텀 ActionSheet(네이티브 Alert 대신, UI-21) */}
      <ActionSheet
        visible={benchAsk}
        title={`벤치 건의 — ${p.name}`}
        message={`정말 ${p.name} 선수의 휴식을 건의할까요? 감독이 판단해 수락하거나 거절합니다.\n어떤 명분으로 건의하시겠습니까?`}
        actions={(['noResign', 'form', 'prospect'] as BenchReason[]).map((reason) => ({
          label: BENCH_REASON_KO[reason], onPress: () => busy.run('감독이 라인업을 다시 그리는 중…', () => benchResult(suggestBench(p.id, reason))),
        }))}
        onClose={() => setBenchAsk(false)}
      />
      <BusyOverlay visible={busy.busy} message={busy.message} />

      {/* 면담 모달 — 시스템 Alert 대신 앱 테마 디자인 */}
      <Modal
        visible={talkAsk || !!talkResult}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => { setTalkAsk(false); setTalkResult(null); }}
      >
        <Pressable style={mstyles.backdrop} onPress={() => { setTalkAsk(false); setTalkResult(null); }}>
          <Pressable style={mstyles.dialog} onPress={() => {}}>
            {talkResult ? (
              <>
                <Text style={[mstyles.title, { color: talkResult.color }]}>{talkResult.title}</Text>
                <Text style={mstyles.body}>{talkResult.msg}</Text>
                <Pressable style={mstyles.primary} onPress={() => setTalkResult(null)}>
                  <Text style={mstyles.primaryTxt}>확인</Text>
                </Pressable>
              </>
            ) : topic ? (
              <>
                <Text style={mstyles.title}>면담 — {p.name}</Text>
                <Text style={mstyles.badge}>😟 {topicBadgeText}</Text>
                <Text style={mstyles.quote}>{topicSpeechText}</Text>
                <Text style={mstyles.body}>무엇을 약속하시겠습니까?</Text>
                {(['reinforce', 'starter', 'raise', 'franchise'] as TalkCard[]).map((card) => (
                  <Pressable key={card} style={({ pressed }) => [mstyles.choice, pressed && { opacity: 0.6 }]} onPress={() => chooseTalk(card)}>
                    <Text style={mstyles.choiceTxt}>{CARD_KO[card]}</Text>
                    <Text style={mstyles.choiceArrow}>›</Text>
                  </Pressable>
                ))}
                <Pressable style={mstyles.cancel} onPress={() => setTalkAsk(false)}>
                  <Text style={mstyles.cancelTxt}>닫기</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  fogBadge: { width: 62, height: 62, borderRadius: 31, borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  fogOvrTxt: { color: theme.muted, fontSize: 15, fontWeight: '900' },
  fogOvrCap: { color: theme.muted, fontSize: 9, fontWeight: '700' },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: theme.cardAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: 84, height: 84, resizeMode: 'cover' },
  pName: { color: theme.text, fontSize: 24, fontWeight: '900' },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: 10 },
  // 입단 후 성장 — 2열 그리드(스탯명 왼쪽 · ▲N 우측)
  growWrap: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  growCell: { width: '50%', flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingRight: 14 },
  growName: { color: theme.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  growDelta: { color: theme.good, fontSize: 13.5, fontWeight: '900', marginLeft: 8 },
}));

const mstyles = themedStyles(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0B121CCC', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: {
    width: '100%', maxWidth: 420, backgroundColor: theme.cardAlt, borderRadius: 18, padding: 20, gap: 8,
    borderWidth: 1.5, borderColor: theme.accent + '66', // 다크 배경에 묻히던 경계 — 민트 틴트 테두리로 또렷하게(UI-10)
    elevation: 16, shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  title: { color: theme.text, fontSize: 18, fontWeight: '900' },
  badge: { color: theme.bad, fontSize: 13, fontWeight: '800' },
  quote: { color: theme.muted, fontSize: 14, fontStyle: 'italic', lineHeight: 20 },
  body: { color: theme.text, fontSize: 14, lineHeight: 20, marginBottom: 2 },
  choice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.cardAlt, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, marginTop: 4 },
  choiceTxt: { color: theme.text, fontSize: 15, fontWeight: '700' },
  choiceArrow: { color: theme.accent, fontSize: 20, fontWeight: '900' },
  cancel: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  cancelTxt: { color: theme.muted, fontSize: 14, fontWeight: '700' },
  // 공용 Button과 같은 글래스 톤(14R·민트 틴트·민트 보더/글씨·액센트 글로우) — 다이얼로그 자체 CTA(2026-06-28 UI-7)
  primary: {
    backgroundColor: theme.accentGlass, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8,
    borderWidth: 1.5, borderColor: theme.accent,
    shadowColor: theme.accent, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 3 },
  },
  primaryTxt: { color: theme.accent, fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },
}));
