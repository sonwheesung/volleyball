import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Card, Muted, OvrBadge, PosTag, Row, Screen, StatBar, Title, theme } from '../../components/Screen';
import { discontentNow, TOPIC_SPEECH, TOPIC_BADGE, ARCHETYPE_KO, conditionOf, popularityNow } from '../../data/owner';
import { playerFans, fanOverlapRatio } from '../../engine/owner';
import { rosterIdsOnDay, seasonScandals, suspendedOnDay, availableTeamPlayers, teamInjuriesOn } from '../../data/dynamics';
import { SCANDAL_KO } from '../../engine/scandal';
import { CARD_KO, BENCH_REASON_KO, type TalkCard, type BenchReason } from '../../engine/owner';
import { getEvolvedPlayer, getTeam, shortTeamName as teamShort, currentRosters } from '../../data/league';
import { buildLineup } from '../../engine/lineup';
import { getPlayerProduction } from '../../data/production';
import { awardHistoryOf } from '../../data/awards';
import { effectiveContract } from '../../data/roster';
import { isFranchise } from '../../engine/cap';
import { overall, overallRaw } from '../../engine/overall';
import { TRAITS } from '../../engine/traits';
import { deriveRatings } from '../../engine/ratings';
import { contractStatus, formatMoney } from '../../engine/salary';
import { marketVal } from '../../data/awardSalary';
import { useGameStore } from '../../store/useGameStore';
import { relationsOf } from '../../data/relationships';

const STATUS_COLOR = { 저평가: theme.good, 적정: theme.muted, 고평가: theme.bad } as const;


export default function PlayerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentDay = useGameStore((s) => s.currentDay);
  const overrides = useGameStore((s) => s.contractOverrides);
  const archive = useGameStore((s) => s.archive);
  const milestones = useGameStore((s) => s.milestones);
  const myTeamId = useGameStore((s) => s.selectedTeamId);
  const season = useGameStore((s) => s.season);
  const interviews = useGameStore((s) => s.interviews);
  const benchDirectives = useGameStore((s) => s.benchDirectives);
  const requestInterview = useGameStore((s) => s.requestInterview);
  const suggestBench = useGameStore((s) => s.suggestBench);
  const suggestStart = useGameStore((s) => s.suggestStart);
  const unbench = useGameStore((s) => s.unbench);
  const talkCooldown = useGameStore((s) => s.talkCooldown);
  const benchCooldown = useGameStore((s) => s.benchCooldown);
  const bonds = useGameStore((s) => s.bonds);
  const [talkAsk, setTalkAsk] = useState(false);
  const [talkResult, setTalkResult] = useState<{ title: string; color: string; msg: string } | null>(null);
  const p = id ? getEvolvedPlayer(id, currentDay) : undefined;
  const prod = id ? getPlayerProduction(id, currentDay) : undefined;
  const awardHist = id ? awardHistoryOf(archive, id) : [];
  const myMilestones = id ? milestones.filter((m) => m.playerId === id) : [];

  if (!p) {
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

  // ── 구단주 레이어 (내 팀 선수만) ──
  const isMine = !!myTeamId && rosterIdsOnDay(myTeamId, currentDay).includes(p.id);
  const moodInfo = isMine && myTeamId ? discontentNow(p, myTeamId, currentDay) : null;
  const topic = moodInfo?.topic ?? null;
  const cond = isMine && myTeamId ? conditionOf(myTeamId, p.id, currentDay) : null;
  const myTalks = interviews.filter((l) => l.playerId === p.id && l.season === season);
  const lastTalkFailed = myTalks.length > 0 && !myTalks[myTalks.length - 1].ok;
  const benched = benchDirectives.some((b) => b.playerId === p.id);

  // 주전/후보 — 그 팀의 실제 출전 라인업(부상·정지·벤치 제외 = 경기 엔진과 동일)에서 선발 6인+리베로 여부.
  // 구단주가 선발/벤치 건의 여부를 판단하는 핵심 정보(사용자 보고). 결장 사유가 있으면 그걸 우선 표시.
  const teamOfP = (() => { const rs = currentRosters(); for (const t of Object.keys(rs)) if (rs[t].includes(p.id)) return t; return null; })();
  const role: { text: string; color: string } | null = (() => {
    if (!teamOfP) return null;
    const avail = availableTeamPlayers(teamOfP, currentDay);
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

  const openBench = () => {
    Alert.alert(
      `감독에게 벤치 건의 — ${p.name}`,
      '어떤 명분으로 건의하시겠습니까?',
      [
        ...(['noResign', 'form', 'prospect'] as BenchReason[]).map((reason) => ({
          text: BENCH_REASON_KO[reason],
          onPress: () => {
            const ok = suggestBench(p.id, reason);
            Alert.alert(ok ? '감독 수락' : '감독 거절',
              ok ? `감독: "알겠습니다. 당분간 ${p.name} 선수는 제외하겠습니다."`
                 : `감독: "받아들일 수 없습니다. 라인업은 제가 책임집니다."\n(에이스 제외 요구·감독 소신·지시 정원 초과 시 거절)`);
          },
        })),
        { text: '취소', style: 'cancel' as const },
      ],
    );
  };

  return (
    <Screen title={p.name}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="person" size={26} color={theme.muted} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <PosTag pos={p.position} full />
              {role ? (
                <View style={{ backgroundColor: role.color + '22', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <Text style={{ color: role.color, fontWeight: '800', fontSize: 12 }}>{role.text}</Text>
                </View>
              ) : null}
              {p.isAsianQuota ? <Text style={{ color: theme.elite, fontWeight: '700' }}>아시아쿼터{p.nationality ? `·${p.nationality}` : ''}</Text> : p.isForeign ? <Text style={{ color: theme.bad, fontWeight: '700' }}>외국인</Text> : null}
              {isFranchise(p) ? <Text style={{ color: theme.warn, fontWeight: '700' }}>프랜차이즈</Text> : null}
            </View>
            <Muted>{p.age}세 · {p.height}cm · 전성기 {p.peakAge}세</Muted>
          </View>
          <OvrBadge value={overallRaw(p)} size={56} />
        </View>
        {suspendedOnDay(currentDay).has(p.id) ? (
          <Text style={{ color: theme.bad, fontWeight: '800', fontSize: 13 }}>
            🚫 출장 정지 중 — {SCANDAL_KO[seasonScandals().find((s) => s.playerId === p.id)!.kind]}
          </Text>
        ) : null}
        <Row>
          <Muted>인기 / 개인 팬</Muted>
          <Text style={{ color: theme.text, fontWeight: '700' }}>
            {popularityNow(p, currentDay, archive)} · {playerFans(popularityNow(p, currentDay, archive)).toLocaleString()}명
            <Text style={{ color: theme.muted, fontSize: 12 }}> (팀팬 겹침 {Math.round(fanOverlapRatio(p.clubTenure) * 100)}%)</Text>
          </Text>
        </Row>
      </Card>

      {p.traits && p.traits.length > 0 ? (
        <>
          <Title>특성</Title>
          <Card>
            {p.traits.map((t) => {
              const d = TRAITS[t];
              return (
                <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                  <Text style={{ color: d.good ? theme.good : theme.bad, fontWeight: '800', width: 76 }}>
                    {d.good ? '▲' : '▼'} {d.name}
                  </Text>
                  <Text style={{ color: theme.muted, fontSize: 12, flex: 1 }}>{d.desc}</Text>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      {(() => {
        const rel = relationsOf(p.id, bonds);
        if (!rel.friends.length && !rel.rivals.length) return null;
        return (
          <>
            <Title>인간관계</Title>
            <Card>
              {rel.friends.length > 0 ? (
                <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                  <Text style={{ color: theme.good, fontWeight: '800', width: 54 }}>친한</Text>
                  <Text style={{ color: theme.text, flex: 1 }}>{rel.friends.map((f) => f.name).join(', ')}</Text>
                </View>
              ) : null}
              {rel.rivals.length > 0 ? (
                <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                  <Text style={{ color: theme.bad, fontWeight: '800', width: 54 }}>라이벌</Text>
                  <Text style={{ color: theme.text, flex: 1 }}>{rel.rivals.map((r) => r.name).join(', ')}</Text>
                </View>
              ) : null}
            </Card>
          </>
        );
      })()}

      {isMine && cond ? (
        <>
          <Title>구단주 면담</Title>
          <Card>
            <Row>
              <Muted>컨디션</Muted>
              <Text style={{ color: cond.color, fontWeight: '800' }}>● {cond.label}</Text>
            </Row>
            {p.faPref ? (
              <>
                <Row>
                  <Muted>성격</Muted>
                  <Text style={{ color: theme.text, fontWeight: '800', fontSize: 13 }}>
                    {ARCHETYPE_KO[p.faPref.archetype].emoji} {ARCHETYPE_KO[p.faPref.archetype].label}
                  </Text>
                </Row>
                <Muted style={{ fontSize: 12 }}>{ARCHETYPE_KO[p.faPref.archetype].note}</Muted>
              </>
            ) : null}
            {moodInfo ? (
              <Row>
                <Muted>지금 마음</Muted>
                <Text style={{ color: moodInfo.mood === 'discontent' ? theme.bad : moodInfo.mood === 'positive' ? theme.good : theme.muted, fontWeight: '800', fontSize: 13 }}>
                  {moodInfo.mood === 'discontent' ? '😟' : moodInfo.mood === 'positive' ? '😊' : '😐'} {moodInfo.label}
                </Text>
              </Row>
            ) : null}
            {topic ? (
              <>
                <Text style={{ color: theme.bad, fontWeight: '800', marginTop: 4 }}>😟 {TOPIC_BADGE[topic]}</Text>
                <Muted style={{ fontSize: 13 }}>{TOPIC_SPEECH[topic]}</Muted>
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
          </Card>

          <Title>감독 건의</Title>
          <Card>
            {benched ? (
              <Button label="복귀 지시 (벤치 해제)" onPress={() => { unbench(p.id); Alert.alert('복귀', `${p.name} 선수가 출전 명단에 복귀합니다. 실전 감각은 몇 경기에 걸쳐 돌아옵니다.`); }} />
            ) : (
              <>
                <Muted style={{ fontSize: 12 }}>
                  현장 권한은 감독에게 — 구단주는 건의합니다. 감독 성향에 따라 거절할 수 있고,
                  인기 선수를 오래 벤치에 두면 팬들이 분노합니다(기사·관중·예산).
                </Muted>
                {benchLeft > 0 ? <Muted style={{ fontSize: 12 }}>⏳ 최근 건의 — 약 {benchLeft}일 뒤 다시 건의할 수 있습니다.</Muted> : null}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={benchLeft > 0 ? `선발 (${benchLeft}일 후)` : '선발 기용 건의'}
                      disabled={!isCandidate || benchLeft > 0}
                      onPress={() => {
                        const ok = suggestStart(p.id);
                        Alert.alert(ok ? '감독 수락' : '감독 거절',
                          ok ? `감독: "알겠습니다. ${p.name} 선수에게 기회를 주죠."\n(동포지션 주전 한 명이 벤치로 내려갑니다)`
                             : `감독: "지금 라인업이 최선입니다."\n(격차가 크거나 감독 소신이 강하면 거절합니다)`);
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label={benchLeft > 0 ? `벤치 (${benchLeft}일 후)` : '벤치 건의'} onPress={openBench} disabled={!isStarter || benchLeft > 0} />
                  </View>
                </View>
              </>
            )}
          </Card>
        </>
      ) : null}

      <Title>계약</Title>
      <Card>
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
          <Title>이번 시즌 기록</Title>
          <Card>
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
          <Title>통산 기록 ({p.career.seasons}시즌)</Title>
          <Card>
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
          <Title>시즌별 기록</Title>
          <Card>
            {p.seasonLines.slice().reverse().map((l) => (
              <View key={l.season} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <Text style={{ color: theme.muted, fontSize: 12, width: 56 }}>{l.season + 1}시즌</Text>
                <Text style={{ color: theme.muted, fontSize: 12, width: 56 }} numberOfLines={1}>{teamShort(l.teamId)}</Text>
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
          <Title>수상 이력</Title>
          <Card>
            {awardHist.map((a, i) => (
              <View key={`${a.season}-${a.label}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <Text style={{ color: theme.muted, fontSize: 12, width: 56 }}>{a.season + 1}시즌</Text>
                <Text style={{ color: theme.warn, fontSize: 13, fontWeight: '800' }}>🏆 {a.label}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {myMilestones.length > 0 ? (
        <>
          <Title>마일스톤</Title>
          <Card>
            {myMilestones.slice(-8).reverse().map((m, i) => (
              <View key={`${m.season}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <Text style={{ color: theme.muted, fontSize: 12, width: 56 }}>{m.season + 1}시즌</Text>
                <Text style={{ color: m.big ? theme.warn : theme.text, fontSize: 13, flex: 1 }}>{m.text}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Title>종합 스탯 (윗단)</Title>
      <Card>
        <StatBar label="스파이크" value={r.spike} />
        <StatBar label="블로킹" value={r.block} />
        <StatBar label="디그" value={r.dig} />
        <StatBar label="리시브" value={r.receive} />
        <StatBar label="세팅" value={r.set} />
        <StatBar label="서브" value={r.serve} />
      </Card>

      <Title>세부 스탯 (밑단)</Title>
      <Card>
        <Muted style={{ marginBottom: 2 }}>신체</Muted>
        <StatBar label="점프력" value={p.jump} />
        <StatBar label="민첩성" value={p.agility} />
        <StatBar label="체력" value={p.staminaMax} />
        <StatBar label="체젠" value={p.staminaRegen} />
        <View style={{ height: 6 }} />
        <Muted style={{ marginBottom: 2 }}>공통 / 멘탈</Muted>
        <StatBar label="반응속도" value={p.reaction} />
        <StatBar label="위치선정" value={p.positioning} />
        <StatBar label="집중력" value={p.focus} />
        <StatBar label="기복" value={p.consistency} />
        <StatBar label="VQ" value={p.vq} />
      </Card>

      <Title>기술치</Title>
      <Card>
        <StatBar label="공격기술" value={p.skSpike} />
        <StatBar label="블로킹기술" value={p.skBlock} />
        <StatBar label="디그기술" value={p.skDig} />
        <StatBar label="리시브기술" value={p.skReceive} />
        <StatBar label="세팅기술" value={p.skSet} />
        <StatBar label="서브기술" value={p.skServe} />
      </Card>

      {/* 면담 모달 — 시스템 Alert 대신 앱 테마 디자인 */}
      <Modal
        visible={talkAsk || !!talkResult}
        transparent
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
                <Text style={mstyles.badge}>😟 {TOPIC_BADGE[topic]}</Text>
                <Text style={mstyles.quote}>"{TOPIC_SPEECH[topic]}"</Text>
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

const mstyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0B121CCC', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 420, backgroundColor: theme.card, borderRadius: 18, padding: 20, gap: 8 },
  title: { color: theme.text, fontSize: 18, fontWeight: '900' },
  badge: { color: theme.bad, fontSize: 13, fontWeight: '800' },
  quote: { color: theme.muted, fontSize: 14, fontStyle: 'italic', lineHeight: 20 },
  body: { color: theme.text, fontSize: 14, lineHeight: 20, marginBottom: 2 },
  choice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.cardAlt, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, marginTop: 4 },
  choiceTxt: { color: theme.text, fontSize: 15, fontWeight: '700' },
  choiceArrow: { color: theme.accent, fontSize: 20, fontWeight: '900' },
  cancel: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  cancelTxt: { color: theme.muted, fontSize: 14, fontWeight: '700' },
  primary: { backgroundColor: theme.accent, borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  primaryTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
