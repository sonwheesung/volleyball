// 독립 검증 — pickRest 가 빈 avail 에서 throw 하는가(restedOnDay→allProdRows 크래시 전파 가능성).
import { pickRest } from '../engine/lineup';

let threw=0, total=0;
// rest-roll 이 발동하는 (teamId,day) 를 찾아 빈 배열을 던진다 — A/B: 비어있으면 throw, 정상명단이면 통과
for(let day=0; day<400; day++){
  total++;
  try { pickRest([], 't0', day); }   // 빈 avail
  catch(e){ threw++; if(threw<=2) console.log(`  day ${day}: throw "${(e as Error).message}"`); }
}
console.log(`빈 avail: ${total} 일 중 ${threw} 일에서 throw (rest-roll 발동일)`);

// A/B 음성대조: 비지 않은 avail 은 절대 throw 안 함
import { generateLeague } from '../data/seed';
const lg = generateLeague(1);
const A = lg.teams[0].players.map(id=>lg.players.find(p=>p.id===id)!) as any[];
let ok=0,err=0;
for(let day=0; day<400; day++){ try{ pickRest(A, 't0', day); ok++; }catch{ err++; } }
console.log(`정상 16인 avail: ${ok} 통과 / ${err} throw (기대 throw=0)`);
