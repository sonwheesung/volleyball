# 배구 엔진 테스트 콘솔 (sim-web)

PC 브라우저에서 게임 엔진(`engine/`·`data/`)을 직접 돌려 결과를 검증하는 **백엔드 없는** 콘솔.
RN·AsyncStorage·expo 의존은 `_stubs/`로 무력화(엔진은 순수 TS라 실제로 안 씀). 앱(Expo)과 별개.

## 실행
```
npm run sim:web          # 빌드+감시+정적 서버 → http://localhost:5051/ (폰: http://<PC IP>:5051/)
npm run sim:web:build    # 1회 빌드만 (sim-web/index.html 을 그냥 열어도 됨)
```
> 포트 5051(사도전 콘솔이 5050이라 충돌 회피). `--port=NNNN` 으로 변경 가능.

## 구성
- `build.cjs` — esbuild 번들(`main.ts` → `dist/bundle.js`) + `--serve` 정적 서버.
- `index.html` — 콘솔 UI(탭·폼·결과). `main.ts` — 폼 읽어 엔진 실행 → 렌더.
- `_stubs/` — react-native·async-storage no-op 스텁.

## 탭
- **경기** ✅ — 두 팀 골라 1경기(박스스코어) 또는 N경기(승률·세트 분포).
- 관계 / FA / 영입 / 분포(KOVO) — 추가 예정(우리가 `tools/sim*.ts`로 보는 엔진을 화면으로).
