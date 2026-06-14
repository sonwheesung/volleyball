// 영입 무결성 감사 (QA 대시보드) — FA·드래프트·외인·감독/코치/스카우터 영입을 N시즌 굴려
// "한 사람 = 한 팀" 불변식을 전수 검사. 라이브 세이브는 격리(snapshot/restore)되어 안전.
// 엔진: data/acquisitionAudit. 개발/검증용 — 단장실에서 진입.
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Button, Card, Muted, Row, Screen, Title, theme } from '../components/Screen';
import { runAcquisitionAudit, type AuditReport } from '../data/acquisitionAudit';
import { DEV_TOOLS } from '../data/flags';

const PRESETS = [8, 16, 30];

export default function Audit() {
  if (!DEV_TOOLS) return <Redirect href="/(tabs)/" />; // 개발용 — 실전 빌드에선 진입 차단
  const [seasons, setSeasons] = useState(8);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const run = (n: number) => {
    setSeasons(n);
    setRunning(true);
    setReport(null);
    // 한 프레임 양보해 스피너를 먼저 그린 뒤 동기 감사 실행(무거운 루프 — JS 스레드 점유)
    setTimeout(() => {
      try { setReport(runAcquisitionAudit(n)); }
      finally { setRunning(false); }
    }, 30);
  };

  return (
    <Screen title="영입 무결성 감사">
      <Card>
        <Muted>
          FA·드래프트·외국인 트라이아웃·감독/코치/스카우터 영입을 여러 시즌 자동으로 굴려
          <Title> 한 선수·한 감독이 두 팀에 동시에 들어가거나 잘못 배정되는지</Title> 전수 검사합니다.
          진행 중인 게임 세이브는 건드리지 않습니다(격리 실행).
        </Muted>
      </Card>

      <Row>
        {PRESETS.map((n) => (
          <View key={n} style={{ flex: 1, marginHorizontal: 2 }}>
            <Button label={`${n}시즌`} variant={seasons === n ? 'primary' : 'ghost'} disabled={running} onPress={() => run(n)} />
          </View>
        ))}
      </Row>
      <Muted style={{ fontSize: 12 }}>시즌 수가 클수록 철저하지만 느립니다(휴대폰에서 30시즌은 수 초 소요).</Muted>

      {running ? (
        <Card>
          <Row>
            <ActivityIndicator color={theme.accent} />
            <Muted style={{ marginLeft: 10 }}>{seasons}시즌 감사 중… (화면이 잠시 멈출 수 있습니다)</Muted>
          </Row>
        </Card>
      ) : null}

      {report ? (
        <>
          <Card>
            <Row>
              <Title>{report.ok ? '✅ 전체 통과' : '❌ 위반 발견'}</Title>
              <Muted>{report.seasons}시즌</Muted>
            </Row>
            <Muted style={{ fontSize: 12, marginTop: 4 }}>
              스트레스: FA영입 {report.stats.faSigned} · 감독경질 {report.stats.coachFired} · 감독영입 {report.stats.coachHired} · 코치영입 {report.stats.asstHired} · 스카우터영입 {report.stats.scoutHired}
            </Muted>
          </Card>

          {report.checks.map((c) => (
            <Card key={c.key} onPress={c.samples.length ? () => setExpanded((e) => ({ ...e, [c.key]: !e[c.key] })) : undefined}>
              <Row>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Title>{c.pass ? '✅' : '❌'} {c.name}</Title>
                </View>
                <Muted style={{ color: c.pass ? theme.good : theme.bad, fontWeight: '800' }}>
                  위반 {c.violations}
                </Muted>
              </Row>
              {!c.pass && expanded[c.key] ? (
                <View style={{ marginTop: 6, gap: 3 }}>
                  {c.samples.map((s, i) => (
                    <Muted key={i} style={{ fontSize: 11, color: theme.bad }}>· {s}</Muted>
                  ))}
                  {c.violations > c.samples.length ? (
                    <Muted style={{ fontSize: 11 }}>… 외 {c.violations - c.samples.length}건</Muted>
                  ) : null}
                </View>
              ) : !c.pass ? (
                <Muted style={{ fontSize: 11, marginTop: 2 }}>탭하면 위반 예시 표시</Muted>
              ) : null}
            </Card>
          ))}
        </>
      ) : !running ? (
        <Muted style={{ fontSize: 12, marginTop: 8 }}>시즌 수를 골라 감사를 시작하세요.</Muted>
      ) : null}
    </Screen>
  );
}
