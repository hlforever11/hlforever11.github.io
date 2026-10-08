import {readFileSync} from 'node:fs';
import vm from 'node:vm';

export function browserApi(fetchImpl=async()=>{throw Error('Offline: no external requests')}) {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const nodes=new Map(),cache=new Map();
  const element=()=>({textContent:'',innerHTML:'',value:'',style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){},querySelectorAll(){return[]},scrollIntoView(){},focus(){},click(){}});
  const document={querySelector(s){if(!nodes.has(s))nodes.set(s,element());return nodes.get(s)},querySelectorAll(){return[]},addEventListener(){}};
  const context={document,window:{},pdfjsLib:{GlobalWorkerOptions:{}},console:{warn(){},error(){}},URL,Response,TextDecoder,Uint8Array,AbortController,Date,fetch:fetchImpl,localStorage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},MutationObserver:class{observe(){}disconnect(){}},setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer},clearTimeout,alert(){}};
  vm.createContext(context);
  const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/mg,'');
  vm.runInContext(script+'\nthis.api={parseReference,verifyOneLocal,canonicalCitation,differences,scoreCandidate,queryCrossref,yearFromCrossref,parseDoiCitation,refs,extractReferences,loadChineseJournalIndex,TRUSTED_REFERENCE_CACHE};',context);
  return {api:context.api,context,nodes};
}
