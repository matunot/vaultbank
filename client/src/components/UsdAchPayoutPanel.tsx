import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Download, FileText, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api';

type Payout = { id: string; requestReference: string; amount: number; beneficiaryName: string; destinationAccountMasked: string; destinationRoutingMasked: string; status: string; customerName?: string; customerEmail?: string; batchId?: string | null };
type Batch = { id: string; batchReference: string; effectiveDate: string; fileIdModifier: string; fileSha256: string; payoutCount: number; totalAmount: number; status: string };
function nextWeekday() { const d = new Date(); d.setDate(d.getDate()+1); while ([0,6].includes(d.getDay())) d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); }
function downloadFile(text: string, name: string) { const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=us-ascii'})); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }

export default function UsdAchPayoutPanel({ visible }: { visible: boolean }) {
  const user=api.getUser() as any;
  const admin=['admin','super_admin'].includes(String(user?.role||'').toLowerCase());
  const [availability,setAvailability]=useState<any>(null);
  const [mine,setMine]=useState<Payout[]>([]);
  const [queue,setQueue]=useState<Payout[]>([]);
  const [batches,setBatches]=useState<Batch[]>([]);
  const [amount,setAmount]=useState('');
  const [beneficiaryName,setBeneficiaryName]=useState(String(user?.full_name||user?.fullName||user?.name||''));
  const [routingNumber,setRoutingNumber]=useState('');
  const [accountNumber,setAccountNumber]=useState('');
  const [accountType,setAccountType]=useState<'checking'|'savings'>('checking');
  const [authorized,setAuthorized]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const [effectiveDate,setEffectiveDate]=useState(nextWeekday());
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [bankRefs,setBankRefs]=useState<Record<string,string>>({});
  const [rejects,setRejects]=useState<Record<string,boolean>>({});
  const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const requestKey=useRef<string|null>(null); const batchKey=useRef<string|null>(null);

  const reload=useCallback(async()=>{
    const [a,m]=await Promise.all([api.usdAchAvailability().catch(()=>({success:false})),api.usdAchPayoutRequests().catch(()=>({success:false,requests:[]}))]);
    if(a.success)setAvailability(a);
    if(m.success)setMine(m.requests||[]);
    if(admin){
      const states=await Promise.all(['reserved','approved','exported'].map(s=>api.usdAchAdminRequests(s).catch(()=>({requests:[]}))));
      const unique=new Map<string,Payout>(); for(const state of states)for(const p of state.requests||[])unique.set(p.id,p);
      setQueue(Array.from(unique.values()));
      const b=await api.usdAchAdminBatches().catch(()=>({success:false,batches:[]})); if(b.success)setBatches(b.batches||[]);
    }
  },[admin]);
  useEffect(()=>{if(visible)void reload();},[visible,reload]);

  const action=async(fn:()=>Promise<any>,message:string)=>{
    setBusy(true);setError('');setNotice('');
    try{const r=await fn();if(!r?.success)throw new Error(r?.message||'Operation failed.');setNotice(message);await reload();}
    catch(e:any){setError(e?.message||'Request failed.');}finally{setBusy(false);}
  };
  const submit=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      if(!requestKey.current)requestKey.current=crypto.randomUUID();
      const r=await api.createUsdAchPayout({amount,beneficiaryName,routingNumber,accountNumber,accountType,authorizationAccepted:authorized},requestKey.current);
      if(!r.success)throw new Error(r.message||'Payout request failed.');
      requestKey.current=null;setAmount('');setRoutingNumber('');setAccountNumber('');setAuthorized(false);
      setNotice('USD request reserved. No bank transfer has been sent.');await reload();
    }catch(e:any){setError(e?.message||'Payout request failed.');}finally{setBusy(false);}
  };
  const createBatch=async()=>{
    setBusy(true);setError('');setNotice('');
    try{
      if(!batchKey.current)batchKey.current=crypto.randomUUID();
      const r=await api.createUsdAchBatch({requestIds:selected,effectiveDate},batchKey.current);
      if(!r.success)throw new Error(r.message||'ACH export failed.');
      batchKey.current=null;if(r.fileContent)downloadFile(r.fileContent,'vaultbank-ach-'+effectiveDate+'-'+(r.batch?.fileIdModifier||'A')+'.ach');
      setSelected([]);setNotice('ACH file generated only. It has not been sent to a bank.');await reload();
    }catch(e:any){setError(e?.message||'ACH export failed.');}finally{setBusy(false);}
  };
  const downloadBatch=(batch:Batch)=>action(async()=>{const r=await api.usdAchAdminBatchFile(batch.id);if(r.success&&r.fileContent)downloadFile(r.fileContent,'vaultbank-ach-'+batch.effectiveDate+'-'+batch.fileIdModifier+'.ach');return r;},'File downloaded; bank acceptance/settlement is not implied.');
  if(!visible)return null;
  const canRequest=!!availability?.available&&(admin||availability.customerAccessEnabled);

  return <section className="glass-panel rounded-3xl p-6 space-y-4">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-display text-xl text-white">USD bank payout · ACH</h3><p className="mt-1 text-sm text-white/50">Native NACHA file preparation. The authorized ODFI must accept/process the file and settlement must be reconciled separately.</p></div><span className={'rounded-full px-2 py-1 text-[10px] font-bold '+(availability?.available?'bg-emerald-400/10 text-emerald-300':'bg-white/5 text-white/40')}>{availability?.available?'CONFIGURED':'DISABLED'}</span></div>
    {availability&&!availability.available&&<p className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">Disabled: requires an authorized ODFI file profile and an encryption key. No automatic USD bank transfer is active.</p>}
    {availability?.available&&!canRequest&&<p className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100/80">ODFI file profile configured, but customer access is off. This remains admin-only until explicitly authorized.</p>}
    {error&&<p className="flex gap-2 rounded-xl border border-rose-300/20 p-3 text-sm text-rose-200"><AlertCircle className="h-4 w-4 shrink-0"/>{error}</p>}
    {notice&&<p className="rounded-xl border border-emerald-300/20 p-3 text-sm text-emerald-100">{notice}</p>}
    {canRequest&&<form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <label className="text-xs text-white/60">Amount USD<input required type="number" min="10" max="10000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white"/></label>
      <label className="text-xs text-white/60">Beneficiary name (must match profile)<input required maxLength={22} value={beneficiaryName} onChange={e=>setBeneficiaryName(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white"/></label>
      <label className="text-xs text-white/60">ABA routing number<input required pattern="[0-9]{9}" maxLength={9} inputMode="numeric" value={routingNumber} onChange={e=>setRoutingNumber(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white"/></label>
      <label className="text-xs text-white/60">US bank account number<input required maxLength={17} autoComplete="off" value={accountNumber} onChange={e=>setAccountNumber(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white"/></label>
      <label className="text-xs text-white/60">Account type<select value={accountType} onChange={e=>setAccountType(e.target.value as 'checking'|'savings')} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white"><option value="checking">Checking</option><option value="savings">Savings</option></select></label>
      <label className="flex items-start gap-2 text-xs text-white/55 md:col-span-2"><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/>I authorize VaultBank to reserve this USD amount; this request/file does not mean funds were sent or settled.</label>
      <button type="submit" disabled={busy||!authorized} className="flex items-center justify-center gap-2 rounded-xl bg-cyan-500 p-3 text-sm font-bold text-white disabled:opacity-50 md:col-span-2">{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<ShieldCheck className="h-4 w-4"/>}Request USD bank payout</button>
    </form>}
    <div><h4 className="mb-2 text-sm font-semibold text-white">My USD payout requests</h4>{mine.length===0?<p className="text-sm text-white/40">No USD ACH requests.</p>:mine.map(p=><div key={p.id} className="mb-2 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3"><div><p className="text-sm text-white">{'$'}{p.amount.toFixed(2)} · {p.destinationAccountMasked}</p><p className="text-xs text-white/40">{p.requestReference} · {p.status}</p></div></div>)}</div>
    {admin&&<div className="space-y-4 border-t border-white/10 pt-5">
      <div className="flex items-center justify-between"><h4 className="font-semibold text-white">Admin USD ACH queue</h4><button type="button" disabled={busy} onClick={()=>void reload()} className="flex items-center gap-1 text-xs text-white/50"><RefreshCw className="h-3 w-3"/>Refresh</button></div>
      {queue.map(p=><div key={p.id} className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
        <p className="text-sm text-white">{p.customerName||p.beneficiaryName} · {'$'}{p.amount.toFixed(2)} · {p.destinationAccountMasked} / {p.destinationRoutingMasked}</p><p className="text-xs text-white/40">{p.requestReference} · {p.status}</p>
        {p.status==='reserved'&&<><textarea value={notes[p.id]||''} onChange={e=>setNotes({...notes,[p.id]:e.target.value})} placeholder="Approval note (10-500 chars)" className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-white"/><button type="button" disabled={busy||(notes[p.id]||'').trim().length<10} onClick={()=>void action(()=>api.approveUsdAchPayout(p.id,notes[p.id]),'Payout approved for ACH file preparation.')} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white">Approve</button></>}
        {p.status==='approved'&&<label className="flex gap-2 text-xs text-white/70"><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id))}/>Select for ACH batch</label>}
        {p.status==='exported'&&<><input value={bankRefs[p.id]||''} onChange={e=>setBankRefs({...bankRefs,[p.id]:e.target.value})} placeholder="Official bank settlement reference" className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-white"/><textarea value={notes[p.id]||''} onChange={e=>setNotes({...notes,[p.id]:e.target.value})} placeholder="Official bank evidence (10-500 chars)" className="w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-white"/><button type="button" disabled={busy||!bankRefs[p.id]||(notes[p.id]||'').trim().length<10} onClick={()=>void action(()=>api.settleUsdAchPayout(p.id,{settlementAmount:p.amount.toFixed(2),bankReference:bankRefs[p.id],evidenceNote:notes[p.id]}),'Payout reconciled against official bank evidence.')} className="rounded-lg bg-emerald-500/20 px-3 py-2 text-xs text-emerald-100">Confirm bank settlement</button></>}
      </div>)}
      {queue.some(p=>p.status==='approved')&&<div className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4"><h5 className="text-sm font-semibold text-white">Export ACH file</h5><label className="text-xs text-white/60">Effective date<input type="date" value={effectiveDate} onChange={e=>setEffectiveDate(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-white"/></label><p className="text-xs text-white/45">{selected.length} requests selected; file generation does not transmit it.</p><button type="button" disabled={busy||!selected.length||!availability?.available||selected.length>(availability?.maxBatchEntries||500)} onClick={()=>void createBatch()} className="flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<FileText className="h-4 w-4"/>}Generate ACH file</button></div>}
      <div><h5 className="mb-2 text-sm font-semibold text-white">Recent ACH batches</h5>{batches.length===0?<p className="text-xs text-white/40">No batches generated.</p>:batches.map(b=><div key={b.id} className="mb-2 rounded-xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm text-white">{b.batchReference} · {'$'}{b.totalAmount.toFixed(2)}</p><p className="text-xs text-white/40">{b.payoutCount} entries · {b.effectiveDate} · {b.status}</p><p className="break-all text-[10px] text-white/30">{b.fileSha256}</p></div><button type="button" disabled={busy||b.status!=='file_generated'} onClick={()=>void downloadBatch(b)} className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-white disabled:opacity-40"><Download className="h-3 w-3"/>Download</button></div>
        {b.status==='file_generated'&&<><textarea value={notes[b.id]||''} onChange={e=>setNotes({...notes,[b.id]:e.target.value})} placeholder="Official proof ODFI did not accept/send this file" className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-white"/><label className="flex gap-2 text-xs text-white/50"><input type="checkbox" checked={rejects[b.id]||false} onChange={e=>setRejects({...rejects,[b.id]:e.target.checked})}/>Confirm ODFI said the file was not accepted or sent</label><button type="button" disabled={busy||!rejects[b.id]||(notes[b.id]||'').trim().length<10} onClick={()=>void action(()=>api.rejectUsdAchBatch(b.id,notes[b.id],true),'Batch rejected; further file downloads are blocked.')} className="mt-2 rounded-lg border border-rose-400/20 px-3 py-2 text-xs text-rose-200">Mark file rejected</button></>}
      </div>)}</div>
      <p className="text-[10px] text-white/35">File generation is not settlement. Only confirm against official bank evidence. Exported-entry refunds require explicit whole-batch rejection first.</p>
    </div>}
  </section>;
}
