// 공지사항 재열람 (BACKEND_SYSTEM §13.13) — 마이페이지 진입점. 활성 공지 전체를 읽음 무관하게 나열.
// 서버 bootstrap이 활성분(기간 내)만 pinned·최신순으로 반환 → 그대로 렌더. 무푸시 관전형(진입해서 볼 때만).
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, IconLabel, Muted, Screen, theme, themedStyles } from '../components/Screen';
import { getBootstrap } from '../lib/server';

type Ann = { id: string; title: string; body: string; pinned: boolean };

export default function Announcements() {
  const [state, setState] = useState<{ loading: boolean; items: Ann[]; offline: boolean }>({ loading: true, items: [], offline: false });

  useEffect(() => {
    let alive = true;
    getBootstrap()
      .then((r) => { if (alive) setState({ loading: false, items: r.ok ? r.announcements : [], offline: !r.ok }); })
      .catch(() => { if (alive) setState({ loading: false, items: [], offline: true }); });
    return () => { alive = false; };
  }, []);

  return (
    <Screen title="공지사항">
      {state.loading ? (
        <Muted style={{ textAlign: 'center', marginTop: 24 }}>불러오는 중…</Muted>
      ) : state.offline ? (
        <Card accent={theme.warn}>
          <IconLabel icon="cloud-offline-outline" color={theme.warn}>연결 필요</IconLabel>
          <Muted style={{ fontSize: 13, marginTop: 4 }}>공지사항을 불러오려면 네트워크 연결이 필요합니다.</Muted>
        </Card>
      ) : state.items.length === 0 ? (
        <Card accent={theme.muted}>
          <IconLabel icon="megaphone-outline" color={theme.muted}>공지 없음</IconLabel>
          <Muted style={{ fontSize: 13, marginTop: 4 }}>현재 표시할 공지사항이 없습니다.</Muted>
        </Card>
      ) : (
        state.items.map((a) => (
          <Card key={a.id} accent={a.pinned ? theme.warn : theme.accent}>
            <View style={styles.head}>
              {a.pinned ? <View style={styles.pin}><Text style={styles.pinTxt}>고정</Text></View> : null}
              <Text style={styles.title}>{a.title}</Text>
            </View>
            <Text style={styles.body}>{a.body}</Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 5 },
  pin: { backgroundColor: theme.warn + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  pinTxt: { color: theme.warn, fontSize: 10.5, fontWeight: '800' },
  title: { color: theme.text, fontSize: 16, fontWeight: '800', flex: 1 },
  body: { color: theme.muted, fontSize: 13.5, lineHeight: 20 },
}));
