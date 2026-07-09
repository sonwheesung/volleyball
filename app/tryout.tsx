// 외국인 트라이아웃 (FOREIGN_SYSTEM) — 매 오프시즌, 팀당 1명·1년 계약·연봉 고정(캡 제외).
// 순번은 추첨. 위시리스트로 노리고, 순번에서 뺏기면 차순위. 미리보기 = endSeason 결과(동일 빌더).

import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, IconLabel, Loading, Muted, PosTag, Row, Screen, Title, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { BusyOverlay, useBusyRun } from '../components/BusyOverlay';
import { SpotlightOverlay, SpotlightTarget } from '../components/Spotlight';
import { buildDraftContextFrom, buildOffseasonBase } from '../data/draftSetup';
import { buildOwnerFx } from '../data/owner';
import { getTeam, teamScoutReveal, getEvolvedTeamPlayers } from '../data/league';
import { ForeignResumeDetail } from '../components/ForeignResumeDetail';
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
  const ownerFx = useMemo(() => buildOwnerFx(interviews, season, my, fanScore), [interviews, season, my, fanScore]);
  const base = useMemo(
    () => buildOffseasonBase(my, resignDecisions, contractOverrides, season + 1, ownerFx),
    [my, resignDecisions, contractOverrides, season, ownerFx],
  );
  const ctx = useMemo(
    () => buildDraftContextFrom(base, my, Object.keys(faOffers), false, protectedIds, season + 1, ownerFx, cash, tryoutWish, keepForeign, [], [], null, faOffers),
    [base, my, faOffers, protectedIds, season, ownerFx, cash, tryoutWish, keepForeign],
  );
  const myForeign = useMemo(
    () => getEvolvedTeamPlayers(my, currentDay).find((p) => p.isForeign),
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
      <SpotlightTarget id="tryout-pick">
      <Card accent={theme.bad}>
        <Muted style={{ fontSize: 12 }}>
          외국인 선수는 <Text style={{ fontWeight: '800', color: theme.text }}>팀당 1명</Text> — 아포짓(OP) 위주의 팀 공격 핵심입니다(여자부 외인 자리). 매 오프시즌
          {' '}<Text style={{ fontWeight: '800', color: theme.text }}>추첨 순번</Text>대로 1명을 데려옵니다 · 1년 계약 · 연봉 {formatMoney(FOREIGN_SALARY)} 고정(샐러리캡 제외, 운영 자금 지출).
          선수를 누르면 검증된 이력(이전 리그 성적·폼·수상·부상 — 스카우터 등급 따라 공개)이 펼쳐집니다. 우측 위시로 노리면 순번에서 자동 지명하고, 앞 팀이 뺏으면 차순위로 내려갑니다.
        </Muted>
        <Row>
          <IconLabel icon="globe-outline" color={theme.bad}>내 예상 지명</IconLabel>
          <Text style={{ color: theme.accent, fontWeight: '800' }}>
            {myPickId && snap[myPickId] ? `${snap[myPickId].name} (${snap[myPickId].position})` : '-'}
          </Text>
        </Row>
      </Card>
      </SpotlightTarget>

      {myForeign ? (
        <>
          <Title>재계약 우선권 — {myForeign.name} ({myForeign.age}세 · OVR {displayOvr(overallRaw(myForeign))})</Title>
          <Card accent={theme.bad}>
            {myForeign.age + 1 >= RETIRE_AGE ? (
              // 정년(FOREIGN_SYSTEM §1.6): 다음 시즌 나이 40+ → 재계약 불가(리그 정년). 새 얼굴을 지명하세요.
              <Muted style={{ fontSize: 12 }}>
                정년 도달({RETIRE_AGE}세) — 재계약 불가입니다(리그 정년은 외인에도 적용). 아래 후보에서 새 얼굴을 지명하세요.
              </Muted>
            ) : (
              <>
                <Muted style={{ fontSize: 12 }}>
                  드래프트 없이 현 외인과 갱신할 수 있습니다(1년 단위 — 잘하는 용병은 수 시즌 함께).
                  풀로 보내면 다른 팀이 지명할 수 있습니다.
                </Muted>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  {([['자동(추천)', null], ['재계약', true], ['풀로 보냄', false]] as const).map(([label, v]) => (
                    <Pressable
                      key={label}
                      onPress={() => busy.run('스카우트 리포트를 정리하는 중…', () => setKeepForeign(v))}
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
        <Title>후보 ({pool.length}명) — ★ 위시 토글</Title>
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
            <View key={p.id} style={[styles.rowWrap, wishIdx >= 0 && { borderColor: theme.warn, borderWidth: 1 }]}>
              <View style={styles.rowInner}>
                <Pressable onPress={() => setOpenId(open ? null : p.id)} style={styles.rowTap}>
                  <PosTag pos={p.position} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.name}>{p.name}</Text>
                      {returning ? <Text style={styles.tagReturn}>재참가</Text> : null}
                    </View>
                    <Text style={styles.sub}>
                      {p.age}세 · {p.height}cm · OVR {fogOvr(p)} · {taker ? `→ ${taker}` : '미지명'} · {open ? '접기 ▲' : '이력 ▼'}
                    </Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => busy.run('스카우트 리포트를 정리하는 중…', () => toggleTryoutWish(p.id))} hitSlop={8} style={styles.wishBtn}>
                  <Text style={{ color: wishIdx >= 0 ? theme.warn : theme.muted, fontWeight: '900', fontSize: 13 }}>
                    {wishIdx >= 0 ? `★${wishIdx + 1}` : '위시'}
                  </Text>
                </Pressable>
              </View>
              {open ? <ForeignResumeDetail p={p} reveal={reveal} /> : null}
            </View>
          );
        })}

      <Muted style={{ fontSize: 11 }}>
        미지명자 중 상위 {tryout.altPoolIds.length}명은 대체 풀로 남아 시즌 중 교체(1회)에 쓸 수 있습니다.
        스카우터 투자(공개도 {(reveal * 100).toFixed(0)}%)가 도박의 보험입니다.
      </Muted>
      <Button label="아시아쿼터 트라이아웃 →" onPress={() => router.push('/asian-tryout')} />
      <SpotlightOverlay screen="tryout" />
      <BusyOverlay visible={busy.busy} message={busy.message} />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: theme.border },
  rowWrap: { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  wishBtn: { paddingHorizontal: 14, paddingVertical: 14, borderLeftWidth: 1, borderLeftColor: theme.border, minWidth: 60, alignItems: 'center' },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  tagReturn: { color: theme.accent, fontSize: 11, fontWeight: '700' },
  tagWish: { color: theme.warn, fontSize: 12, fontWeight: '900' },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipTxt: { color: theme.text, fontSize: 13, fontWeight: '700' },
}));
