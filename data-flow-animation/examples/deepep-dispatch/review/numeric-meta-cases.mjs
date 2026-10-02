import {reference} from './numeric-reference.mjs';
export function* metaCases(m){const c=m.config,ref=reference(m),step=m.frames.length-1;
 const expectedConfig={...c,hiddenBytes:c.H*(c.fp8?1:2),sfBytes:c.sfPacks*2,metadataBytes:ref.byteSize.meta,tokenBytes:ref.byteSize.record,regionBytes:c.M*ref.byteSize.record,bufferBytes:c.R*c.M*ref.byteSize.record};
 for(const [key,expected] of Object.entries(expectedConfig))yield {query:{objectId:`@config.${key}`,step},expected};
 for(const l of Object.values(m.ledger)){yield{query:{objectId:'@dtype',object:l.id,step},expected:l.dtype};for(let dim=0;dim<l.shape.length;dim++)yield{query:{objectId:'@shape',object:l.id,index:dim,step},expected:l.shape[dim]};yield{query:{objectId:'@bytes',object:l.id,step},expected:l.bytes};}
 for(let rank=0;rank<c.R;rank++){
  const h=ref.hits.slice(rank*2,rank*2+2),received=ref.counts.reduce((n,x)=>n+x[rank],0),expanded=h.reduce((n,x)=>n+Math.ceil(x/c.A)*c.A,0),sourceHits=ref.tokens.filter(t=>t.r===rank).reduce((n,t)=>n+t.idx.filter(e=>e>=0).length,0);
  for(const [key,value] of [['recvCount',received],['expandedCount',expanded],['sourceExpertHits',sourceHits],['capacitySlots',c.R*c.M]])yield {query:{objectId:`@metric.${key}`,rank,value,step},expected:value};
  for(let expert=0;expert<2;expert++)for(const [key,value] of [['expertCount',h[expert]],['expertStart',ref.start[rank][expert]]])yield{query:{objectId:`@metric.${key}`,rank,expert,value,step},expected:value};
 }
 for(const tok of ref.tokens){const n=tok.gsge.filter(i=>i>=0).length;for(const [key,value]of[['sqeCount',n],['sgeCount',n*2]])yield{query:{objectId:`@metric.${key}`,tokenKey:tok.key,value,step},expected:value};yield{query:{objectId:'@metric.globalIdx',sourceRank:tok.r,token:tok.t,value:tok.gid,step},expected:tok.gid};}
 for(const f of m.frames)for(const [access,value]of[['read',f.reads.length],['write',f.writes.length]])yield{query:{objectId:'@metric.accessCount',access,value,step:f.step},expected:value};
}
