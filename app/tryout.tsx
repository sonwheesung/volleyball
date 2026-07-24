// 외국인 트라이아웃 (FOREIGN_SYSTEM) — 매 오프시즌, 팀당 1명·1년 계약·연봉 고정(캡 제외).
// 순번은 추첨. 위시리스트로 노리고, 순번에서 뺏기면 차순위. 미리보기 = endSeason 결과(동일 빌더).

import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Loading, Muted, PosTag, Screen, Title, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { BusyOverlay, useBusyRun } from '../components/BusyOverlay';
import { useOffseasonExit } from '../components/offseasonExit';
import { confirmDraftPickReset } from '../components/draftPickGuard';
import { ExpandableRow } from '../components/ExpandableRow';
import { StatTriad } from '../components/StatTriad';
import { SpotlightOverlay, SpotlightTarget } from '../components/Spotlight';
import { buildDraftContextFrom, buildOffseasonBase } from '../data/draftSetup';
import { buildOwnerFx } from '../data/owner';
import { getTeam, teamScoutReveal, getEvolvedTeamPlayers } from '../data/league';
import { ForeignResumeDetail } from '../components/ForeignResumeDetail';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { FaceSheetWarmup } from '../components/FaceSheetWarmup';
import { overall, overallRaw, displayOvr } from '../engine/overall';
import { fogOvr as fogOvrShared } from '../data/prospectScout';
import { FOREIGN_SALARY } from '../engine/foreign';
import { RETIRE_AGE } from '../engine/retire';
import { formatMoney } from '../engine/salary';
import { useGameStore } from '../store/useGameStore';
import type { Player } from '../types';

export default function Tryout() {
  // 트라이아웃 컨텍스트 생성(buildDraftContext)은 무거워 한 틱 미뤄 로딩부터 그린다
  const ready = useDeferredReady();
  if (!ready) return <Loading title="외국인 트라이아웃" variant="list" />;
  return <TryoutInner />;
}

function TryoutInner() {
  const router = useRouter();
  const exit = useOffseasonExit(); // 오프시즌 허브 복귀(§5.6) — 다음 단계로 push하지 않는다
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const contractOverrides = useGameStore((s) => s.contractOverrides);
  const faOffers = useGameStore((s) => s.faOffers); // FA 오퍼 다레버(§2.8 Phase1) — 구 faSignings+faAggressive 대체
  const protectedIds = useGameStore((s) => s.protectedIds);
  const interviews = useGameStore((s) => s.interviews);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);
  const tryoutWish = useGameStore((s) => s.tryoutWish);
  const toggleTryoutWish = useGameStore((s) => s.toggleTryoutWish);
  const keepForeign = useGameStore((s) => s.keepForeign);
  const setKeepForeign = useGameStore((s) => s.setKeepForeign);
  const currentDay = useGameStore((s) => s.currentDay);
  const [openId, setOpenId] = useState<string | null>(null);
  // 스냅샷/해결 분리(REALTIME_SIM §7.3): 무거운 리그 롤오버 스냅샷(base)은 안정 deps로 메모, 위시/보유 토글은
  //   가벼운 해결(buildDraftContextFrom)만 재실행 → 탭마다 스냅샷 재빌드하던 낭비 제거. 여전히 오버레이 마스킹(UI-27).
  const busy = useBusyRun();

  // endSeason과 같은 체인 — 미리보기=결과
  const ownerFx = useMemo(() => buildOwnerFx(interviews, season, my, fanScore, contractOverrides), [interviews, season, my, fanScore, contractOverrides]);
  const base = useMemo(
    () => buildOffseasonBase(my, resignDecisions, contractOverrides, season + 1, ownerFx),
    [my, resignDecisions, contractOverrides, season, ownerFx],
  );
  const ctx = useMemo(
    () => buildDraftContextFrom(base, my, Object.keys(faOffers), false, protectedIds, season + 1, ownerFx, cash, tryoutWish, keepForeign, [], [], null, faOffers),
    [base, my, faOffers, protectedIds, season, ownerFx, cash, tryoutWish, keepForeign],
  );
  const myForeign = useMemo(
    // OP 외국인만 — 아시아쿼터도 isForeign:true라 !isAsianQuota로 분리(§7.1 라이프사이클 분리, replaceForeign과 동일 패턴)
    () => getEvolvedTeamPlayers(my, currentDay).find((p) => p.isForeign && !p.isAsianQuota),
    [my, currentDay, season],
  );
  const tryout = ctx.tryout;
  const snap = ctx.snapshot;
  const order = useMemo(() => {
    const seen: string[] = [];
    for (const [t] of Object.entries(tryout.picks)) seen.push(t);
    return seen;
  }, [tryout]);
  const myPickId = tryout.picks[my];

  const reveal = teamScoutReveal(my);
  // 공용 fogOvr(data/prospectScout → engine/overall 정본)에 위임 — 로컬 중복 제거(동작 동일).
  const fogOvr = (p: Player): string => fogOvrShared(p, reveal);

  const pool = tryout.poolIds.map((id) => snap[id]).filter((p): p is Player => !!p);
  const pickedBy = (pid: string): string | null => {
    const t = Object.keys(tryout.picks).find((k) => tryout.picks[k] === pid);
    return t ? (getTeam(t)?.name ?? t) : null;
  };

  return (
    <Screen title="외국인 트라이아웃">
      {/* 후보 아바타 시트 첫 디코드 지연(플레이스홀더 잔존) 방지 — 목록보다 먼저 필요한 시트만 워밍(UI-45).
          같은 화면 워밍은 디코드 시작을 못 앞당기므로, 다음 화면(아시아쿼터) 풀 시트까지 여기서 선행 워밍(한 화면 앞 워밍). */}
      <FaceSheetWarmup ids={[...pool.map((p) => p.id), ...ctx.asianTryout.poolIds]} size={60} />
      <SpotlightTarget id="tryout-pick">
      <Card accent={theme.bad} flat>
        <IconLabel icon="globe-outline" color={theme.bad}>트라이아웃 현황</IconLabel>
        <StatTriad cells={[
          { label: '등록 선수', value: `${pool.length}명` },
          { label: '스카우터 공개도', value: `${(reveal * 100).toFixed(0)}%` },
          { label: '내 예상 지명', value: myPickId && snap[myPickId] ? snap[myPickId].name : '-', color: theme.accent },
        ]} />
        <Muted style={{ fontSize: 12 }}>
          외국인 선수는 <Text style={{ fontWeight: '800', color: theme.text }}>팀당 1명</Text>, 아포짓(OP) 위주의 팀 공격 핵심입니다(여자부 외인 자리). 매 오프시즌
          {' '}<Text style={{ fontWeight: '800', color: theme.text }}>추첨 순번</Text>대로 1명을 데려옵니다 · 1년 계약 · 연봉 {formatMoney(FOREIGN_SALARY)} 고정(샐러리캡 제외, 운영 자금 지출).
          선수를 누르면 검증된 이력(이전 리그 성적·폼·수상·부상, 스카우터 등급 따라 공개)이 펼쳐집니다. 우측 위시로 노리면 순번에서 자동 지명하고, 앞 팀이 뺏으면 차순위로 내려갑니다.
        </Muted>
      </Card>
      </SpotlightTarget>

      {/* ~~다음 단계(아시아쿼터)로 push~~ → 정정(2026-07-24 §5.6): 체인 해체 — 일정 허브로 복귀한다.
          상단 배치는 유지(후보 목록이 길어 최하단이면 묻힘, 2026-07-13 테스터). */}
      <Button label="오프시즌 준비로 →" onPress={exit} />
      {/* 미리보기 신뢰(§5.6.3 ⑥) — 외인 결정이 FA 예산(cashAfterImports)을 바꾼다. 무거운 프리뷰 대신 정적 안내. */}
      <Muted style={{ fontSize: 11.5 }}>
        외국인 재계약·지명 결정을 바꾸면 FA에 쓸 운영 자금이 달라집니다. 결정을 바꿨다면 FA 센터를 한 번 더 확인하세요.
      </Muted>

      {myForeign ? (
        <>
          <Title>재계약 우선권, {myForeign.name} ({myForeign.age}세 · OVR {displayOvr(overallRaw(myForeign))})</Title>
          <Card accent={theme.bad} flat>
            {myForeign.age + 1 >= RETIRE_AGE ? (
              // 정년(FOREIGN_SYSTEM §1.6): 다음 시즌 나이 40+ → 재계약 불가(리그 정년). 새 얼굴을 지명하세요.
              <Muted style={{ fontSize: 12 }}>
                정년 도달({RETIRE_AGE}세). 재계약 불가입니다(리그 정년은 외인에도 적용). 아래 후보에서 새 얼굴을 지명하세요.
              </Muted>
            ) : (
              <>
                <Muted style={{ fontSize: 12 }}>
                  드래프트 없이 현 외인과 갱신할 수 있습니다(1년 단위, 잘하는 외국인 선수는 수 시즌 함께).
                  풀로 보내면 다른 팀이 지명할 수 있습니다.
                </Muted>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  {([['자동(추천)', null], ['재계약', true], ['풀로 보냄', false]] as const).map(([label, v]) => (
                    <Pressable
                      key={label}
                      onPress={() => confirmDraftPickReset(() => busy.run('스카우트 리포트를 정리하는 중…', () => setKeepForeign(v)))}
                      style={[styles.chip, keepForeign === v && styles.chipOn]}
                    >
                      <Text style={[styles.chipTxt, keepForeign === v && { color: theme.bg }]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </Card>
        </>
      ) : null}

      <SpotlightTarget id="tryout-wish">
        <Title>후보 ({pool.length}명), ★ 위시 토글</Title>
      </SpotlightTarget>
      {pool
        .slice()
        .sort((a, b) => overall(b) - overall(a))
        .map((p) => {
          const wishIdx = tryoutWish.indexOf(p.id);
          const taker = pickedBy(p.id);
          const returning = !p.id.startsWith('fgn-s');
          const open = openId === p.id;
          return (
            <ExpandableRow
              key={p.id}
              selected={wishIdx >= 0}
              onToggle={() => setOpenId(open ? null : p.id)}
              onAction={() => confirmDraftPickReset(() => busy.run('스카우트 리포트를 정리하는 중…', () => toggleTryoutWish(p.id)))}
              action={
                <Text style={{ color: wishIdx >= 0 ? theme.warn : theme.muted, fontWeight: '900', fontSize: 13 }}>
                  {wishIdx >= 0 ? `★${wishIdx + 1}` : '위시'}
                </Text>
              }
              detail={open ? <ForeignResumeDetail p={p} reveal={reveal} /> : null}
            >
              <View style={styles.avatarWrap}>
                <PlayerAvatar id={p.id} size={60} />
              </View>
              <View style={{ flex: 1 }}>
                {/* 이름 + 포지션 + 지명 팀(포지션 오른쪽, 2026-07-12 테스터) */}
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                  <PosTag pos={p.position} />
                  <Text style={[styles.taker, taker ? { color: theme.accent } : null]} numberOfLines={1}>
                    {taker ? `→ ${taker}` : '미지명'}
                  </Text>
                  {returning ? <Text style={styles.tagReturn}>재참가</Text> : null}
                </View>
                <Text style={styles.sub} numberOfLines={1}>
                  {p.age}세 · {p.height}cm · OVR {fogOvr(p)}
                </Text>
                {/* 이력 토글 — 메타 텍스트에 파묻히지 않게 별도 칩(2026-07-11 테스터: UI 그룹화) */}
                <View style={[styles.resumeChip, open && styles.resumeChipOn]}>
                  <Text style={styles.resumeChipTxt}>{open ? '이력 접기 ▲' : '이력 보기 ▼'}</Text>
                </View>
              </View>
            </ExpandableRow>
          );
        })}

      <Muted style={{ fontSize: 11 }}>
        미지명자 중 상위 {tryout.altPoolIds.length}명은 대체 풀로 남아 시즌 중 교체(1회)에 쓸 수 있습니다.
        스카우터 투자(공개도 {(reveal * 100).toFixed(0)}%)가 도박의 보험입니다.
      </Muted>
      <SpotlightOverlay screen="tryout" />
      <BusyOverlay visible={busy.busy} message={busy.message} />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: theme.border },
  // 아바타(60) + 하단 OVR 범위 오버레이 배지(반투명 검정 바 위 흰 글씨)
  avatarWrap: { width: 60, height: 60, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.cardAlt },
  ovrOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.62)', paddingVertical: 1.5, alignItems: 'center' },
  ovrOverlayTxt: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { color: theme.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  sub: { color: theme.muted, fontSize: 13, marginTop: 2 },
  taker: { color: theme.muted, fontSize: 12.5, fontWeight: '600', marginTop: 1 },
  tagReturn: { color: theme.accent, fontSize: 11, fontWeight: '700' },
  tagWish: { color: theme.warn, fontSize: 12, fontWeight: '900' },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.text, fontSize: 13, fontWeight: '700' },
  // 이력 토글 칩 — 텍스트와 분리된 또렷한 인터랙션 어포던스(테두리 pill, 눌리면 accent 배경)
  resumeChip: { alignSelf: 'flex-start', marginTop: 6, borderWidth: 1, borderColor: theme.accent + '80', borderRadius: 8, paddingVertical: 3, paddingHorizontal: 9 },
  resumeChipOn: { backgroundColor: theme.accent + '1A' },
  resumeChipTxt: { color: theme.accent, fontSize: 12, fontWeight: '800' },
}));

// 라우트 에러 폴백(UI-50 ⑦) — 이 화면이 render throw해도 앱이 죽지 않고 "일정으로 돌아가기" 폴백이 뜬다(소프트락 봉인).
export { ErrorBoundary } from '../components/RouteErrorBoundary';
