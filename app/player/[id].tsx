import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Card, Muted, OvrBadge, PosTag, Row, Screen, StatBar, Title, theme } from '../../components/Screen';
import { getEvolvedPlayer, getTeam } from '../../data/league';
import { getPlayerProduction } from '../../data/production';
import { awardHistoryOf } from '../../data/awards';
import { effectiveContract } from '../../data/roster';
import { isFranchise } from '../../engine/cap';
import { overall } from '../../engine/overall';
import { TRAITS } from '../../engine/traits';
import { deriveRatings } from '../../engine/ratings';
import { contractStatus, formatMoney, marketValue } from '../../engine/salary';
import { useGameStore } from '../../store/useGameStore';

const STATUS_COLOR = { 꿀계약: theme.good, 적정: theme.muted, 고연봉: theme.bad } as const;

const teamShort = (teamId: string) => (getTeam(teamId)?.name ?? teamId).split(' ').pop() ?? teamId;

export default function PlayerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const currentDay = useGameStore((s) => s.currentDay);
  const overrides = useGameStore((s) => s.contractOverrides);
  const archive = useGameStore((s) => s.archive);
  const milestones = useGameStore((s) => s.milestones);
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
  const market = marketValue(p, prod);
  const status = contractStatus(contract.salary, market);

  return (
    <Screen title={p.name}>
      <Card>
        <Row>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <PosTag pos={p.position} full />
            {p.isForeign ? <Text style={{ color: theme.bad, fontWeight: '700' }}>외국인</Text> : null}
            {isFranchise(p) ? <Text style={{ color: theme.warn, fontWeight: '700' }}>프랜차이즈</Text> : null}
          </View>
          <OvrBadge value={overall(p)} />
        </Row>
        <Muted>{p.age}세 · {p.height}cm · 전성기 {p.peakAge}세</Muted>
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
    </Screen>
  );
}
