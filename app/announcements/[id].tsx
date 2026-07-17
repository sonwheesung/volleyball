// 공지사항 상세 (BACKEND_SYSTEM §13.13) — 재열람 목록에서 진입. 제목 + 등록일 + 본문(평문).
//   본문은 bootstrap 응답에 포함 → id로 조회(개별 fetch 없음). 목록↔상세 구조는 공지·패치노트·개발자 노트 3화면 통일(2026-07-17).
//   상세 진입 = 그 id 읽음 처리(markAnnouncementsRead — 목록과 동일 패턴). 결정론 격리 — 세이브/시드 무관.
import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Muted, Screen, theme, themedStyles } from '../../components/Screen';
import { getBootstrap } from '../../lib/server';
import { useAuthStore } from '../../store/useAuthStore';
import { fmtDevnoteDate } from '../devnotes';

type Ann = { id: string; title: string; body: string; pinned: boolean; startsAt?: string | null };

export default function AnnouncementDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [ann, setAnn] = useState<Ann | null>(null);
  const [loading, setLoading] = useState(true);

  // bootstrap 활성 공지 중 id로 조회(본문 포함). 상세 = 읽음 처리(목록과 동일 패턴).
  useEffect(() => {
    let alive = true;
    getBootstrap()
      .then((r) => {
        if (!alive) return;
        const found = r.ok ? (r.announcements.find((a) => a.id === id) ?? null) : null;
        setAnn(found);
        setLoading(false);
      })
      .catch(() => { if (alive) { setAnn(null); setLoading(false); } });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    if (id) useAuthStore.getState().markAnnouncementsRead([id]);
  }, [id]);

  if (loading) {
    return (
      <Screen title="공지사항">
        <Muted style={{ textAlign: 'center', marginTop: 24 }}>불러오는 중…</Muted>
      </Screen>
    );
  }
  if (!ann) {
    return (
      <Screen title="공지사항">
        <Muted>공지를 불러올 수 없습니다. 네트워크 연결 후 목록에서 다시 열어주세요.</Muted>
      </Screen>
    );
  }

  const date = fmtDevnoteDate(ann.startsAt ?? null);
  return (
    <Screen title="">
      <Card accent={ann.pinned ? theme.warn : theme.accent} flat>
        <View style={styles.metaRow}>
          {ann.pinned ? <View style={styles.pin}><Text style={styles.pinTxt}>고정</Text></View> : null}
          {date ? <Text style={styles.date}>{date}</Text> : null}
        </View>
        <Text style={styles.headline}>{ann.title}</Text>
      </Card>
      <Card accent={theme.accent} flat>
        <Text style={styles.body}>{ann.body}</Text>
      </Card>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pin: { backgroundColor: theme.warn + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  pinTxt: { color: theme.warn, fontSize: 10.5, fontWeight: '800' },
  date: { color: theme.muted, fontSize: 13 },
  headline: { color: theme.text, fontSize: 22, fontWeight: '900', lineHeight: 30, marginTop: 6 },
  body: { color: theme.text, fontSize: 15, lineHeight: 24 },
}));
