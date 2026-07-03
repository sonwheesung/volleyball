// 약관/정책 렌더러 (data/legalText.ts) — 정적 법적 문서를 조/항목 단위로 표시. 오프라인에서도 열림.
import { StyleSheet, Text, View } from 'react-native';
import { Muted, Screen, theme, themedStyles } from './Screen';
import type { LegalDoc } from '../data/legalText';

export function LegalScreen({ doc }: { doc: LegalDoc }) {
  return (
    <Screen title={doc.title}>
      <Muted style={{ fontSize: 12, marginBottom: 2 }}>최종 수정일: {doc.updated} · 시행일: {doc.effective}</Muted>
      {doc.intro ? <Text style={styles.intro}>{doc.intro}</Text> : null}
      {doc.sections.map((s) => (
        <View key={s.h} style={styles.section}>
          <Text style={styles.h}>{s.h}</Text>
          {s.body.map((line, i) => (
            <Text key={i} style={styles.body}>{line}</Text>
          ))}
        </View>
      ))}
      <View style={{ height: 24 }} />
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  intro: { color: theme.muted, fontSize: 13, lineHeight: 20, marginBottom: 10, marginTop: 6 },
  section: { marginTop: 16 },
  h: { color: theme.text, fontSize: 15.5, fontWeight: '900', marginBottom: 6 },
  body: { color: theme.text, fontSize: 13.5, lineHeight: 21, marginBottom: 3, opacity: 0.9 },
}));
