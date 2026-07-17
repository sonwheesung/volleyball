// 공지사항 재열람 (BACKEND_SYSTEM §13.13) — 마이페이지 진입점. 활성 공지 전체를 읽음 무관하게 나열.
// 서버 bootstrap이 활성분(기간 내)만 pinned·최신순으로 반환 → 목록은 제목+등록일 행으로 렌더, 본문은 상세(app/announcements/[id]).
// 목록↔상세 구조는 공지·패치노트·개발자 노트 3화면 통일(2026-07-17). 무푸시 관전형(진입해서 볼 때만).
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, IconLabel, Muted, Screen, theme, themedStyles } from '../components/Screen';
import { getBootstrap } from '../lib/server';
import { useAuthStore } from '../store/useAuthStore';
import { fmtDevnoteDate } from './devnotes';

type Ann = { id: string; title: string; body: string; pinned: boolean; startsAt?: string | null };

export default function Announcements() {
  const router = useRouter();
  const [state, setState] = useState<{ loading: boolean; items: Ann[]; offline: boolean }>({ loading: true, items: [], offline: false });

  useEffect(() => {
    let alive = true;
    getBootstrap()
      .then((r) => {
        if (!alive) return;
        const items = r.ok ? r.announcements : [];
        setState({ loading: false, items, offline: !r.ok });
        // 재열람 화면에 나열된 공지 = 본 것 → 읽음 처리(다음 부팅 모달 중복 노출 방지, §13.13).
        if (items.length) useAuthStore.getState().markAnnouncementsRead(items.map((a) => a.id));
      })
      .catch(() => { if (alive) setState({ loading: false, items: [], offline: true }); });
    return () => { alive = false; };
  }, []);

  return (
    <Screen title="공지사항">
      {state.loading ? (
        <Muted style={{ textAlign: 'center', marginTop: 24 }}>불러오는 중…</Muted>
      ) : state.offline ? (
        <Card accent={theme.warn} flat>
          <IconLabel icon="cloud-offline-outline" color={theme.warn}>연결 필요</IconLabel>
          <Muted style={{ fontSize: 13, marginTop: 4 }}>공지사항을 불러오려면 네트워크 연결이 필요합니다.</Muted>
        </Card>
      ) : state.items.length === 0 ? (
        <Card accent={theme.muted} flat>
          <IconLabel icon="megaphone-outline" color={theme.muted}>공지 없음</IconLabel>
          <Muted style={{ fontSize: 13, marginTop: 4 }}>현재 표시할 공지사항이 없습니다.</Muted>
        </Card>
      ) : (
        state.items.map((a) => (
          <Card key={a.id} accent={a.pinned ? theme.warn : theme.accent} onPress={() => router.push(`/announcements/${a.id}`)}>
            <View style={styles.head}>
              {a.pinned ? <View style={styles.pin}><Text style={styles.pinTxt}>고정</Text></View> : null}
              <Text style={styles.title} numberOfLines={2}>{a.title}</Text>
            </View>
            {fmtDevnoteDate(a.startsAt ?? null) ? <Text style={styles.date}>{fmtDevnoteDate(a.startsAt ?? null)}</Text> : null}
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  pin: { backgroundColor: theme.warn + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  pinTxt: { color: theme.warn, fontSize: 10.5, fontWeight: '800' },
  title: { color: theme.text, fontSize: 16, fontWeight: '800', flex: 1 },
  date: { color: theme.muted, fontSize: 12, marginTop: 2 },
}));
