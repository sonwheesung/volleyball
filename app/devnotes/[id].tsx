// 개발자 노트/패치노트 상세 (DEVNOTES_SYSTEM §3.2) — 목록에서 진입.
//   제목 + (패치노트면) 버전 태그 + 게시일 + 경량 마크다운 본문(# 제목 · - 리스트 · **굵게** · `코드` · [링크](url)).
//   본문은 목록 응답에 포함돼 캐시로 열림(개별 fetch 없음, §3.4). 캐시에 없으면(캐시 클리어 등) 1회 새로 fetch.
//   상세 진입 = 그 id 읽음 처리(markDevnoteRead, §3.3). 결정론 격리 — 세이브/시드 무관.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Card, Muted, Screen, theme, themedStyles } from '../../components/Screen';
import { useAuthStore } from '../../store/useAuthStore';
import type { DevnoteItem } from '../../lib/server';
import { fmtDevnoteDate, readDevnotesCache, refreshDevnotes } from '../devnotes';

// ── 경량 마크다운(뉴스/가이드 수준 서식, 과설계 금지) — 인라인: **굵게** · `코드` · [링크](url) ──
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    if (m[2] != null) out.push(<Text key={k++} style={styles.bold}>{m[2]}</Text>);
    else if (m[4] != null) out.push(<Text key={k++} style={styles.code}>{m[4]}</Text>);
    else if (m[6] != null) {
      const url = m[7];
      out.push(<Text key={k++} style={styles.link} onPress={() => { void Linking.openURL(url).catch(() => {}); }}>{m[6]}</Text>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return out;
}

// 블록: # 제목(1~3) · - 리스트 · 빈 줄로 문단 구분. 나머지는 문단으로 병합.
function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const nodes: ReactNode[] = [];
    let para: string[] = [];
    let key = 0;
    const flush = () => {
      if (para.length) { nodes.push(<Text key={key++} style={styles.p}>{inline(para.join(' '))}</Text>); para = []; }
    };
    for (const raw of lines) {
      const line = raw.trimEnd();
      const t = line.trim();
      if (!t) { flush(); continue; }
      const h = /^(#{1,3})\s+(.*)$/.exec(t);
      if (h) {
        flush();
        const lvl = h[1].length;
        nodes.push(<Text key={key++} style={lvl === 1 ? styles.h1 : lvl === 2 ? styles.h2 : styles.h3}>{inline(h[2])}</Text>);
        continue;
      }
      const li = /^[-*]\s+(.*)$/.exec(t);
      if (li) {
        flush();
        nodes.push(
          <View key={key++} style={styles.li}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.liText}>{inline(li[1])}</Text>
          </View>,
        );
        continue;
      }
      para.push(t);
    }
    flush();
    return nodes;
  }, [source]);
  return <>{blocks}</>;
}

export default function DevnoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const markDevnoteRead = useAuthStore((s) => s.markDevnoteRead);
  const [note, setNote] = useState<DevnoteItem | null>(null);
  const [loading, setLoading] = useState(true);

  // 캐시에서 id로 조회(본문은 목록 응답에 포함). 없으면 1회 새로 fetch(캐시 클리어/딥링크 대비).
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readDevnotesCache();
      let found = cached?.find((d) => d.id === id) ?? null;
      if (!found) { const fresh = await refreshDevnotes(); found = fresh?.find((d) => d.id === id) ?? null; }
      if (!alive) return;
      setNote(found);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [id]);

  // 상세를 실제로 연 순간 읽음 처리(§3.3). id 확정 시 1회.
  useEffect(() => {
    if (id) markDevnoteRead(id);
  }, [id, markDevnoteRead]);

  if (loading) {
    return (
      <Screen title="개발자 노트">
        <Muted style={{ textAlign: 'center', marginTop: 24 }}>불러오는 중…</Muted>
      </Screen>
    );
  }
  if (!note) {
    return (
      <Screen title="개발자 노트">
        <Muted>글을 불러올 수 없습니다. 네트워크 연결 후 목록에서 다시 열어주세요.</Muted>
      </Screen>
    );
  }

  const date = fmtDevnoteDate(note.publishedAt);
  return (
    <Screen title="">
      <Card accent={theme.accent} flat>
        <View style={styles.metaRow}>
          {note.kind === 'patch' && note.appVersion ? (
            <View style={styles.ver}><Text style={styles.verTxt}>v{note.appVersion}</Text></View>
          ) : null}
          {date ? <Text style={styles.date}>{date}</Text> : null}
        </View>
        <Text style={styles.headline}>{note.title}</Text>
      </Card>
      <Card accent={theme.accent} flat>
        <Markdown source={note.body} />
      </Card>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ver: { backgroundColor: theme.sky + '22', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 1 },
  verTxt: { color: theme.sky, fontSize: 11, fontWeight: '800' },
  date: { color: theme.muted, fontSize: 13 },
  headline: { color: theme.text, fontSize: 22, fontWeight: '900', lineHeight: 30, marginTop: 6 },
  // 마크다운 본문
  h1: { color: theme.text, fontSize: 19, fontWeight: '900', lineHeight: 27, marginTop: 8 },
  h2: { color: theme.text, fontSize: 17, fontWeight: '800', lineHeight: 24, marginTop: 6 },
  h3: { color: theme.text, fontSize: 15, fontWeight: '800', lineHeight: 22, marginTop: 4 },
  p: { color: theme.text, fontSize: 15, lineHeight: 24 },
  li: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bullet: { color: theme.accent, fontSize: 15, lineHeight: 24 },
  liText: { color: theme.text, fontSize: 15, lineHeight: 24, flex: 1 },
  bold: { fontWeight: '800' },
  code: { fontFamily: 'monospace', backgroundColor: theme.cardAlt, color: theme.mutedBright, fontSize: 14 },
  link: { color: theme.accent, textDecorationLine: 'underline' },
}));
