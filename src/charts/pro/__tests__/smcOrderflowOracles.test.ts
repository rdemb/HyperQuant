import { expect, it } from 'vitest';
import { ObservationJournal } from '../core/smcObservation';
import { SmcOrderflow, formationProfile, type FlowElement } from '../core/smcOrderflow';
const e: FlowElement = { id: 'own', kind: 'ob', known: 0, lo: 99, hi: 101, dir: 1, atr: 10, expiresAt: 1e9 };
it('A01 exact oracle and duplicate neutrality', () => {
 const j=new ObservationJournal('BTC'); j.open(0,0); const m=new SmcOrderflow(j); m.update([e],[],'up',0);
 const rows=[{time:1,tid:1,px:100,sz:2,side:1 as const},{time:2,tid:2,px:101,sz:1,side:-1 as const},{time:3,tid:3,px:102,sz:3,side:1 as const}];
 j.trades(rows,4); j.trades(rows,5); m.update([e],[],'up',5); const s=m.current(e.id)!;
 expect([s.since.delta,s.zone.delta,s.since.count]).toEqual([4,1,3]); expect(s.since.pv/s.since.volume).toBeCloseTo(607/6); expect(s.zone.pv/s.zone.volume).toBeCloseTo(301/3);
});
it('A02 chronological delayed L2 completes already observed FVG without rewriting prior observation',()=>{
 const j=new ObservationJournal('BTC'); j.open(0,0); const end=125*60000, origin=110*60000;
 const book=(t:number)=>({time:t,bids:[{px:99,sz:1},{px:98,sz:1}],asks:[{px:101,sz:1},{px:102,sz:1}]});
 for(let t=0;t<end;t+=5000){ j.trades([{time:t,tid:t,px:100,sz:t>=origin?100:1,side:1}],t); if(t<end-10000) j.book(book(t),t,1); }
 const f={...e,kind:'fvg' as const,known:end,originFrom:origin}; const m=new SmcOrderflow(j); m.update([f],[],'up',end);
 expect(m.current(e.id)!.fvg!.depthUsd).toBeNull(); const old=JSON.stringify(m.at(e.id,end));
 j.book(book(end-10000),end+1,1); m.update([f],[],'up',end+1);
 expect(formationProfile(j,f,300000,end+1).depthUsd).not.toBeNull();
 expect(m.current(e.id)!.fvg!.depthUsd).toBe(formationProfile(j,f,300000,end+1).depthUsd);
 expect(JSON.stringify(m.at(e.id,end))).toBe(old);
});
for (const cap of [2,50000]) it(`A03 late burst loss after element ended cannot retain complete anchored totals cap=${cap}`,()=>{
 const j=new ObservationJournal('BTC',{trades:cap,books:2}); j.open(0,0); const m=new SmcOrderflow(j); const ended={...e,endAt:100};
 m.update([ended],[],'up',0); j.trades([{time:10,tid:1,px:100,sz:1,side:1}],10); m.update([ended],[],'up',10); m.update([ended],[],'up',100);
 j.trades(Array.from({length:cap+1},(_,i)=>({time:20,tid:i+2,px:100,sz:1,side:1 as const})),200); m.update([ended],[],'up',200);
 const s=m.current(e.id)!; expect(s.since.volume===cap+2 || !s.complete).toBe(true);
});
