// 화면 이벤트 테스트 ① 죽은 네비게이션 링크 — 모든 router.push/navigate/replace 목적지가
// 실제 라우트 파일과 일치하는지(expo-router 파일기반). 동적 [id]/${}·(tabs) 그룹·쿼리 정규화.
import { readdirSync, statSync, readFileSync } from 'fs';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = `${dir}/${e}`;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.tsx')) out.push(p);
  }
  return out;
}
// 라우트 shape: 세그먼트 배열. (group) 제거, index 제거, [x]→'*'
const routeShape = (file: string): string[] =>
  file.replace(/^app\//, '').replace(/\.tsx$/, '').split('/')
    .filter((s) => !s.startsWith('(') && s !== 'index')
    .map((s) => (s.startsWith('[') ? '*' : s));
// 타겟 shape: 쿼리 제거, 선행 / 제거, (group) 제거, ${...}→'*'
const targetShape = (t: string): string[] =>
  t.split('?')[0].replace(/^\//, '').split('/')
    .filter((s) => s.length && !s.startsWith('('))
    .map((s) => (s.includes('${') ? '*' : s));
const seg = (a: string, b: string) => a === '*' || b === '*' || a === b;
const match = (target: string[], routes: string[][]) =>
  routes.some((r) => r.length === target.length && r.every((s, i) => seg(s, target[i])));

const files = walk('app').filter((f) => !f.endsWith('_layout.tsx'));
const routes = files.map(routeShape);
const dead: string[] = [];
let total = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const re = /router\.(?:push|navigate|replace)\(\s*[`'"]([^`'"]+)[`'"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    total++;
    const t = targetShape(m[1]);
    if (!match(t, routes)) dead.push(`${f.replace(/^app\//, '')}: "${m[1]}" -> [${t.join('/')}]`);
  }
}
console.log(`라우트 파일 ${files.length} · 네비 호출 ${total}건 검사`);
if (dead.length) { console.log(`\n[FAIL] 죽은 링크 ${dead.length}건:`); dead.forEach((d) => console.log('  · ' + d)); }
else console.log('[OK] 죽은 네비게이션 링크 0 — 모든 목적지가 실제 라우트와 일치');
const fakeCaught = !match(targetShape('/nope/x'), routes);
const realPass = match(targetShape('/player/id'), routes);
console.log(`[A/B] 가짜 검출=${fakeCaught} · 실재 통과=${realPass} (각각 true여야 신뢰)`);
process.exit(dead.length === 0 && fakeCaught && realPass ? 0 : 1); // 배터리 게이트: 판정을 exit code로 배선(로그만이면 영구 허위 초록)
