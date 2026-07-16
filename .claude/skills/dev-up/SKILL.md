---
name: dev-up
description: 로컬 개발 체인(Docker PG → dev 서버 :3000 → Expo :8082 → sim-web :5051)을 원커맨드로 기동/복구하고 헬스체크까지 마친다. "서버 열어줘", "dev up", "로컬 체인 복구", "개발 서버 켜줘", "Expo 다시 띄워줘", 백그라운드 dev 프로세스가 죽었다는 태스크 알림을 받았을 때 호출. 정본 절차는 docs/SERVER_OPS.md — 이 스킬은 그 실행 자동화.
---

# dev-up — 로컬 개발 체인 기동/복구

> **왜**: 이 체인은 재부팅·백그라운드 태스크 사망으로 자주 끊기고, 손으로 복구하면 매번 같은 실수가
> 재발한다 — 특히 **서버를 DATABASE_URL 오버라이드 없이 띄워 54322(WinNAT에 막힌 로컬 Supabase)를
> 보다 500**(실사고 2026-07-16). 이 스킬은 판별→기동→헬스체크를 순서대로 강제한다.
> 정본: `docs/SERVER_OPS.md`(운용 절차) · `server-ports` 메모리(8082+5051).

## 체인 구조 (폰 테스트 루프)

```
폰(Expo Go) → Expo Metro :8082 (EXPO_PUBLIC_SERVER_URL=http://<LAN IP>:3000)
            → next dev :3000 (-H 0.0.0.0)
            → Postgres (정석: 로컬 Supabase :54322 / 우회: Docker dev_pg :55432)
```

## 실행 순서 (각 단계 확인 후 다음으로)

### 0. 현황 판별 — 뭐가 죽었나
```bash
netstat -ano | grep -E ":(8082|3000|54322|55432)" | grep LISTEN
docker ps --format "{{.Names}} {{.Status}}" 2>/dev/null | grep dev_pg
curl -s -m 3 http://localhost:3000/api/devnotes   # {"ok":true,...} 면 서버 생존
```
- 살아 있는 단계는 건드리지 않는다(재시작 금지 — 폰 세션 끊김).

### 1. DB — Docker 엔진부터
```bash
docker info >/dev/null 2>&1 || # 엔진 다운이면:
#   PowerShell: Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
#   → docker info 폴링(5초 간격, 최대 2분)
docker start dev_pg && docker exec dev_pg pg_isready -U postgres
```
- **어느 DB인가 판별**: 54322 LISTEN이면 정석 Supabase(오버라이드 불요), 아니면 dev_pg(55432 — **이후 서버 명령 전부에 오버라이드 필수**).
- dev_pg 컨테이너 자체가 없으면 SERVER_OPS §2.1b(`docker run -d --name dev_pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:15-alpine` + drizzle push).

### 2. dev 서버 (:3000)
```bash
# 3000 점유 스테일 프로세스 정리 후(있으면 taskkill //F //PID):
cd /c/project/volleyball/server && DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/postgres" npx next dev -H 0.0.0.0 -p 3000   # run_in_background
# (54322 정석이면 DATABASE_URL 오버라이드 생략 — .env.development.local이 처리)
```
- 헬스 폴링: `curl -s http://localhost:3000/api/devnotes` → `{"ok":true,...}` 나올 때까지(최대 90초).
- **`{"ok":false,"reason":"error"}` = DB 연결 실패 = 십중팔구 오버라이드 누락**(54322를 보고 있음).

### 3. Expo (:8082)
```bash
# LAN IP 확인(바뀔 수 있음): PowerShell (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" }).IPAddress
cd /c/project/volleyball && EXPO_PUBLIC_SERVER_URL="http://<LAN IP>:3000" npx expo start --port 8082   # run_in_background
```
- 8082 LISTEN 폴링. 캐시 깨짐 증상(모듈 resolution 에러)일 때만 `-c` 추가(번들 재빌드 ~1분).
- **루트 .env 수정·커밋 금지** — 재포인트는 셸 env 오버라이드로만(SERVER_OPS §2.4).

### 4. (요청 시) sim-web (:5051)
```bash
cd /c/project/volleyball && npm run sim:web   # run_in_background
```

## 완료 보고 형식

체인 3단 상태를 한 줄씩: DB(어느 쪽·컨테이너 상태) / 서버(헬스 응답 원문) / Expo(리슨 확인 + 폰 접속 안내).

## 함정 (재발 이력)

| 증상 | 원인 | 처방 |
|---|---|---|
| 서버 500 `{"ok":false}` | DATABASE_URL 오버라이드 누락(54322 지향) | §2 오버라이드 붙여 재기동 |
| docker start 실패(pipe 에러) | Docker Desktop 자체 다운(재부팅) | 엔진 기동 후 폴링 |
| 백그라운드 태스크 exit 1인데 로그 무에러 | 외부 종료(재부팅·세션 정리) | 같은 명령 재기동만 — 원인 사냥 불요 |
| 폰에서 "연결 필요" | 앱이 PROD 지향(재포인트 안 됨) | Expo를 EXPO_PUBLIC_SERVER_URL로 재기동 + 앱 리로드 |
| 에뮬에서 접속 | 에뮬은 LAN IP 대신 10.0.2.2 사용 | `exp://10.0.2.2:8082` 딥링크 |
