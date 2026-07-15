"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";

type Order = {
  id: string; status?: string; customerName?: string; customerCode?: string;
  referenceNo?: string; poNo?: string; createdTime?: string;
  shipToAddress?: { name?: string; city?: string; state?: string };
  appointmentTime?: string; carrierId?: string; carrierName?: string;
  loadNo?: string; bolNo?: string; orderType?: string;
  totalPallets?: number; totalWeight?: number;
  orderNote?: string; deliveryInstructions?: string; updatedTime?: string; updatedBy?: string;
};

type Appointment = {
  id: string; sid?: string; carrierId?: string; carrierName?: string;
  appointmentType?: string; appointmentTime?: string; apptStatus?: string;
  createdTime?: string; customerNames?: string[];
  appointmentActions?: { referenceNos?: string[]; receipts?: { customerName?: string }[]; loads?: { loadNo?: string; customerName?: string }[] }[];
};

const API_STATUSES = ["IMPORTED","OPEN","PARTIAL_COMMITTED","COMMIT_BLOCKED","COMMIT_FAILED","COMMITTED","PLANNING","PLANNED","PICKING","PICKED","READY_TO_SHIP","PACKING","PACKED","STAGED","LOADING","LOADED","REOPEN","EXCEPTION","PARTIAL_SHIPPED","BLOCKED","ON_HOLD"];

function fmt(d?: string) { if (!d) return "—"; return new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function slaDeadline(ct: string) { return new Date(new Date(ct).getTime() + 48*3600000); }
function slaInfo(ct?: string, appt?: string): { label: string; cls: string; priority: number } {
  if (appt) { const diff = new Date(appt).getTime() - Date.now(); if (diff > 3600000) return { label: "Scheduled", cls: "good", priority: 5 }; if (diff > 0) return { label: `${Math.round(diff/60000)}m`, cls: "warn", priority: 3 }; if (diff > -3600000) return { label: "In Progress", cls: "warn", priority: 3 }; const h = Math.abs(diff/3600000); return { label: h>=24?`Missed ${(h/24).toFixed(1)}d`:`Missed ${h.toFixed(1)}h`, cls: "bad", priority: 2 }; }
  if (!ct) return { label: "—", cls: "", priority: 5 }; const ms = slaDeadline(ct).getTime()-Date.now(); const hrs = ms/3600000; if (ms<=0){const d=Math.abs(hrs)/24; return {label:d>=1?`${d.toFixed(1)}d Past Due`:`${Math.abs(hrs).toFixed(1)}h Past Due`,cls:"bad",priority:0};} if(hrs<1) return {label:`${Math.round(ms/60000)}m`,cls:"bad",priority:1}; if(hrs<4) return {label:`${hrs.toFixed(1)}h`,cls:"warn",priority:3}; return {label:`${(hrs/24).toFixed(1)}d`,cls:"good",priority:5};
}
function getApptCustomer(a: Appointment): string { if (a.customerNames?.length) return a.customerNames[0]; for (const act of a.appointmentActions||[]) { const c = act.receipts?.find(r=>r.customerName)||act.loads?.find(l=>l.customerName); if (c&&"customerName" in c) return c.customerName!; } return "—"; }
function getApptLoad(a: Appointment): string { for (const act of a.appointmentActions||[]) { const l = act.loads?.[0]; if (l?.loadNo) return l.loadNo; } return "—"; }

async function wmsPost(token: string, path: string, body: unknown) { const res = await fetch("/api/wms",{method:"POST",headers:{"Content-Type":"application/json","x-session-token":token},body:JSON.stringify({path,body})}); const json=await res.json(); if(!res.ok) throw new Error(json.error||"Data unavailable."); return json; }

// --- Cutoff Timer ---
function CutoffTimer() {
  const [,setT]=useState(0); useEffect(()=>{const i=setInterval(()=>setT(t=>t+1),60000);return()=>clearInterval(i)},[]);
  const est=new Date(new Date().toLocaleString("en-US",{timeZone:"America/New_York"})); const cutoff=new Date(est); cutoff.setHours(16,0,0,0);
  if(est>=cutoff) return <span style={{color:"#fb7185",fontWeight:700}}>PAST CUTOFF</span>;
  const diff=cutoff.getTime()-est.getTime(); const h=Math.floor(diff/3600000); const m=Math.floor((diff%3600000)/60000);
  const color=h>=2?"#4ade80":h>=1?"#facc15":m>=30?"#ff7a45":"#fb7185";
  return <span style={{color,fontWeight:700}}>{h}h {m}m</span>;
}

// --- Section ---
function Section({title,defaultOpen=true,children,badge}:{title:string;defaultOpen?:boolean;children:React.ReactNode;badge?:React.ReactNode}) {
  const [open,setOpen]=useState(defaultOpen);
  return (<div style={{marginBottom:12}}><button onClick={()=>setOpen(!open)} style={{display:"flex",alignItems:"center",gap:6,width:"100%",background:"none",border:0,padding:"6px 0",cursor:"pointer",textAlign:"left"}}><span style={{color:"#5539f6",fontSize:11}}>{open?"▼":"▶"}</span><span style={{fontSize:13,fontWeight:700,color:"#eaf0ff"}}>{title}</span>{badge}</button>{open&&<div style={{marginTop:4}}>{children}</div>}</div>);
}

// =============================================================================
export default function CommandCenter() {
  const { token } = useAuth();
  const [orders,setOrders]=useState<Order[]>([]);
  const [appointments,setAppointments]=useState<Appointment[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [tick,setTick]=useState(0);
  const [refreshedAt,setRefreshedAt]=useState("");
  const [stale,setStale]=useState(false);
  const [globalSearch,setGlobalSearch]=useState("");
  const [selectedOrder,setSelectedOrder]=useState<Order|null>(null);
  const [localAppts,setLocalAppts]=useState<Record<string,string>>({});

  useEffect(()=>{const i=setInterval(()=>setTick(t=>t+1),30000);return()=>clearInterval(i)},[]);
  useEffect(()=>{try{const s=sessionStorage.getItem("cesanekApptOverrides");if(s)setLocalAppts(JSON.parse(s))}catch{}},[]);

  const loadData=useCallback(async()=>{
    if(!token)return; setLoading(true);setError("");setStale(false);
    try{
      const [ordJson,apptJson]=await Promise.all([
        wmsPost(token,"/wms-bam/outbound/order/search-by-paging",{currentPage:1,pageSize:100,statuses:API_STATUSES,sortingFields:[{field:"createdTime",orderBy:"DESC"}]}),
        wmsPost(token,"/wms-bam/appointment/search-by-paging",{currentPage:1,pageSize:100}).catch(()=>null),
      ]);
      if(ordJson?.success) setOrders(ordJson.data?.list||[]); else if(Array.isArray(ordJson?.data)) setOrders(ordJson.data);
      if(apptJson?.success) setAppointments(apptJson.data?.list||[]); else if(apptJson&&Array.isArray(apptJson?.data)) setAppointments(apptJson.data);
      setRefreshedAt(new Date().toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit"}));
    }catch(e:unknown){setError(e instanceof Error?e.message:"Unable to load data.");setStale(true);}
    finally{setLoading(false);}
  },[token]);

  useEffect(()=>{loadData()},[loadData]);
  useEffect(()=>{if(!token)return;const i=setInterval(loadData,600000);return()=>clearInterval(i)},[token,loadData]);

  // Search filter
  const searchedOrders=useMemo(()=>{
    if(!globalSearch)return orders;const q=globalSearch.toLowerCase();
    return orders.filter(o=>(o.customerName||"").toLowerCase().includes(q)||(o.referenceNo||"").toLowerCase().includes(q)||(o.loadNo||"").toLowerCase().includes(q)||(o.carrierId||o.carrierName||"").toLowerCase().includes(q)||(o.poNo||"").toLowerCase().includes(q)||(o.bolNo||"").toLowerCase().includes(q)||o.id.includes(q));
  },[orders,globalSearch]);

  // Metrics
  const metrics=useMemo(()=>{
    void tick; let scheduled=0,completed=0,pending=0,missed=0,late=0,rollovers=0,exceptions=0,slaAtRisk=0;
    searchedOrders.forEach(o=>{const ea=localAppts[o.id]||o.appointmentTime;const s=slaInfo(o.createdTime,ea);
      if(s.priority<=0)missed++; else if(s.priority===1){slaAtRisk++;exceptions++;} else if(s.priority===2)missed++; else if(s.priority===3){late++;slaAtRisk++;} else if(s.priority===5)scheduled++; else pending++;
    });
    return {scheduled,completed,pending,missed,late,rollovers,exceptions,slaAtRisk,total:searchedOrders.length};
  },[searchedOrders,localAppts,tick]);

  const apptMetrics=useMemo(()=>{
    void tick;const now=Date.now();let missed=0,upcoming30=0;
    const carrierMissed:Record<string,number>={};const customerMissed:Record<string,number>={};
    appointments.forEach(a=>{const st=(a.apptStatus||"").toUpperCase();if(["COMPLETED","CHECKED_IN","CONFIRM"].includes(st))return;if(!a.appointmentTime)return;
      const diff=new Date(a.appointmentTime).getTime()-now;
      if(diff<-3600000){missed++;const c=a.carrierName||a.carrierId||"Unknown";carrierMissed[c]=(carrierMissed[c]||0)+1;const cu=getApptCustomer(a);customerMissed[cu]=(customerMissed[cu]||0)+1;}
      else if(diff>0&&diff<1800000)upcoming30++;
    });
    const worstCarrier=Object.entries(carrierMissed).sort((a,b)=>b[1]-a[1])[0];
    const mostImpacted=Object.entries(customerMissed).sort((a,b)=>b[1]-a[1])[0];
    return {missed,upcoming30,worstCarrier:worstCarrier?`${worstCarrier[0]} (${worstCarrier[1]})`:"—",mostImpacted:mostImpacted?`${mostImpacted[0]} (${mostImpacted[1]})`:"—",carrierMissed};
  },[appointments,tick]);

  // Priority queue items
  const priorityItems=useMemo(()=>{
    void tick;
    const items=searchedOrders.map(o=>{const ea=localAppts[o.id]||o.appointmentTime;return {...o,sla:slaInfo(o.createdTime,ea),effectiveAppt:ea}});
    return items.filter(i=>i.sla.priority<=3).sort((a,b)=>a.sla.priority-b.sla.priority).slice(0,30);
  },[searchedOrders,localAppts,tick]);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {/* === HEADER === */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #26344f",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:14,alignItems:"center",fontSize:12}}>
          <span style={{color:"#eaf0ff",fontWeight:800,fontSize:14}}>Warehouse Operations Control Center</span>
          <span style={{color:"#8899b4"}}>{new Date().toLocaleDateString("en-US",{timeZone:"America/New_York",weekday:"short",month:"short",day:"numeric"})}</span>
          <span style={{color:"#8899b4"}}>Shift: 8AM–4PM</span>
          <span style={{fontSize:11}}>Cutoff: <CutoffTimer/></span>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",fontSize:11}}>
          <span style={{color:stale?"#fb7185":"#4ade80"}}>{stale?"● Disconnected":"● WMS Live"}</span>
          {refreshedAt&&<span style={{color:"#64748b"}}>Sync: {refreshedAt}</span>}
          <span style={{color:"#64748b"}}>10m refresh</span>
        </div>
      </div>

      {/* Search */}
      <input type="text" placeholder="Search Customer, RN, DN, Load, Carrier, PO..." value={globalSearch} onChange={e=>setGlobalSearch(e.target.value)} style={{border:"1px solid #26344f",background:"#101b31",color:"#eaf0ff",borderRadius:6,padding:"7px 12px",fontSize:12,maxWidth:420}}/>

      {/* === KPI CARDS === */}
      <div className="kpi-row" style={{gridTemplateColumns:"repeat(auto-fit, minmax(95px, 1fr))"}}>
        <div className="kpi-card"><span className="kpi-label">Scheduled</span><span className="kpi-value good">{metrics.scheduled}</span></div>
        <div className="kpi-card"><span className="kpi-label">Pending</span><span className="kpi-value" style={{color:"#3b82f6"}}>{metrics.pending}</span></div>
        <div className="kpi-card"><span className="kpi-label">Missed</span><span className="kpi-value bad">{metrics.missed}</span></div>
        <div className="kpi-card"><span className="kpi-label">Late</span><span className="kpi-value warn">{metrics.late}</span></div>
        <div className="kpi-card"><span className="kpi-label">SLA At Risk</span><span className="kpi-value bad">{metrics.slaAtRisk}</span></div>
        <div className="kpi-card"><span className="kpi-label">Exceptions</span><span className="kpi-value" style={{color:"#ff7a45"}}>{metrics.exceptions}</span></div>
        <div className="kpi-card"><span className="kpi-label">Missed Appts</span><span className="kpi-value bad">{apptMetrics.missed}</span></div>
        <div className="kpi-card"><span className="kpi-label">Upcoming 30m</span><span className="kpi-value warn">{apptMetrics.upcoming30}</span></div>
        <div className="kpi-card"><span className="kpi-label">Open Orders</span><span className="kpi-value">{metrics.total}</span></div>
      </div>

      {/* === OPERATIONS PRIORITY QUEUE === */}
      <div style={{background:"#1a0a0f",border:"1px solid #7f1d1d",borderRadius:10,padding:"12px 16px"}}>
        <h2 style={{margin:"0 0 8px",fontSize:14,color:"#fca5a5"}}>🚨 Operations Priority Queue</h2>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,fontSize:11}}>
          <div><span style={{color:"#fb7185",fontWeight:700,textTransform:"uppercase",fontSize:10}}>Critical</span>
            <div style={{color:"#fca5a5",marginTop:4}}>Missed Appts: <b>{apptMetrics.missed}</b></div>
            <div style={{color:"#fca5a5"}}>SLA Violations: <b>{metrics.missed}</b></div>
            <div style={{color:"#fca5a5"}}>Exceptions: <b>{metrics.exceptions}</b></div>
          </div>
          <div><span style={{color:"#facc15",fontWeight:700,textTransform:"uppercase",fontSize:10}}>High Priority</span>
            <div style={{color:"#fde68a",marginTop:4}}>Worst Carrier: <b>{apptMetrics.worstCarrier}</b></div>
            <div style={{color:"#fde68a"}}>Most Impacted: <b>{apptMetrics.mostImpacted}</b></div>
            <div style={{color:"#fde68a"}}>SLA At Risk: <b>{metrics.slaAtRisk}</b></div>
          </div>
          <div><span style={{color:"#ff7a45",fontWeight:700,textTransform:"uppercase",fontSize:10}}>Upcoming Cutoffs</span>
            <div style={{color:"#ffb088",marginTop:4}}>Due in 30 min: <b>{apptMetrics.upcoming30}</b></div>
            <div style={{color:"#ffb088"}}>Late Carriers: <b>{metrics.late}</b></div>
          </div>
        </div>
      </div>

      {error&&<div className="notice">{error}</div>}

      {/* === MAIN WORKSPACE: Grid Left + Detail Right === */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:12,minHeight:400}}>
        {/* LEFT: Appointment Grid */}
        <div style={{background:"#101b31",border:"1px solid #26344f",borderRadius:10,overflow:"hidden",display:"flex",flexDirection:"column"}}>
          <div style={{padding:"8px 12px",borderBottom:"1px solid #26344f",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,fontWeight:700,color:"#eaf0ff"}}>Orders Requiring Attention ({priorityItems.length})</span>
            <button onClick={loadData} disabled={loading} style={{border:0,borderRadius:5,background:"#5539f6",color:"#fff",padding:"4px 10px",fontSize:10,fontWeight:700,cursor:"pointer"}}>{loading?"...":"Refresh"}</button>
          </div>
          <div style={{flex:1,overflowY:"auto",maxHeight:"calc(100vh - 520px)"}}>
            <table style={{width:"100%",minWidth:"auto"}}>
              <thead><tr><th>Customer</th><th>DN</th><th>Load</th><th>Carrier</th><th>Appt</th><th>SLA</th></tr></thead>
              <tbody>
                {priorityItems.length===0&&<tr><td colSpan={6} style={{textAlign:"center",padding:24,color:"#64748b"}}>No orders requiring immediate attention.</td></tr>}
                {priorityItems.map(o=>(
                  <tr key={o.id} style={{cursor:"pointer",background:selectedOrder?.id===o.id?"#1e2d47":undefined}} onClick={()=>setSelectedOrder(o)}>
                    <td style={{fontSize:11}}>{(o.customerName||o.customerCode||"—").slice(0,16)}</td>
                    <td style={{fontSize:11,fontWeight:600}}>{(o.referenceNo||o.id).slice(0,12)}</td>
                    <td style={{fontSize:10}}>{o.loadNo||"—"}</td>
                    <td style={{fontSize:10}}>{(o.carrierName||o.carrierId||"—").slice(0,12)}</td>
                    <td style={{fontSize:10}}>{o.effectiveAppt?fmt(o.effectiveAppt).slice(0,12):"—"}</td>
                    <td><span className={o.sla.cls} style={{fontSize:10,fontWeight:700}}>{o.sla.label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: Persistent Detail Panel */}
        <div style={{background:"#16233b",border:"1px solid #26344f",borderRadius:10,padding:14,overflowY:"auto",maxHeight:"calc(100vh - 520px)"}}>
          {!selectedOrder?(
            <div style={{textAlign:"center",padding:30,color:"#64748b",fontSize:12}}>Select an order from the grid to view details.</div>
          ):(
            <div style={{fontSize:12,color:"#cdd6f4"}}>
              <h3 style={{fontSize:13,fontWeight:700,color:"#eaf0ff",margin:"0 0 10px",borderBottom:"1px solid #26344f",paddingBottom:6}}>Appointment Summary</h3>
              <Fld l="Customer" v={selectedOrder.customerName||selectedOrder.customerCode}/>
              <Fld l="Carrier" v={selectedOrder.carrierName||selectedOrder.carrierId}/>
              <Fld l="Load #" v={selectedOrder.loadNo}/>
              <Fld l="RN" v={selectedOrder.bolNo}/>
              <Fld l="DN / Order" v={selectedOrder.referenceNo||selectedOrder.id}/>
              <Fld l="Appointment" v={fmt(localAppts[selectedOrder.id]||selectedOrder.appointmentTime)}/>
              <Fld l="SLA Deadline" v={selectedOrder.createdTime?fmt(slaDeadline(selectedOrder.createdTime).toISOString()):"—"}/>
              <Fld l="SLA Status" v={slaInfo(selectedOrder.createdTime,localAppts[selectedOrder.id]||selectedOrder.appointmentTime).label}/>
              <Fld l="Status" v={selectedOrder.status}/>
              <Fld l="Ship To" v={[selectedOrder.shipToAddress?.name,selectedOrder.shipToAddress?.city,selectedOrder.shipToAddress?.state].filter(Boolean).join(", ")}/>
              <Fld l="Pallets" v={selectedOrder.totalPallets?.toString()}/>
              <Fld l="Weight" v={selectedOrder.totalWeight?`${selectedOrder.totalWeight} lbs`:undefined}/>
              <Fld l="Dock" v="—"/>
              <Fld l="Trailer #" v="—"/>
              <Fld l="Driver" v="—"/>
              <Fld l="Check In" v="—"/>

              <h3 style={{fontSize:12,fontWeight:700,color:"#eaf0ff",margin:"14px 0 8px",borderBottom:"1px solid #26344f",paddingBottom:4}}>Customer Communication</h3>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                <a href="/dashboard/tickets" className="panel-btn" style={{textDecoration:"none",fontSize:10}}>Create Ticket</a>
                <a href="/dashboard/notifications" className="panel-btn" style={{textDecoration:"none",fontSize:10}}>Send Notification</a>
              </div>

              <h3 style={{fontSize:12,fontWeight:700,color:"#eaf0ff",margin:"14px 0 8px",borderBottom:"1px solid #26344f",paddingBottom:4}}>Quick Actions</h3>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {["In Progress","Checked In","Late","Missed","Completed","Cancelled","Rescheduled"].map(a=>(
                  <button key={a} className="panel-btn" style={{fontSize:9,padding:"3px 7px"}}>{a}</button>
                ))}
              </div>
              <p style={{fontSize:9,color:"#64748b",marginTop:6}}>Actions update local workflow state only. WMS not mutated.</p>

              <h3 style={{fontSize:12,fontWeight:700,color:"#eaf0ff",margin:"14px 0 8px",borderBottom:"1px solid #26344f",paddingBottom:4}}>Notes / Timeline</h3>
              <p style={{fontSize:11,color:"#64748b"}}>No notes recorded. Use activity log for history.</p>
              <a href="/dashboard/activity-log" style={{fontSize:10,color:"#5539f6",textDecoration:"none"}}>View Activity Log →</a>
            </div>
          )}
        </div>
      </div>

      {/* === BOTTOM COLLAPSIBLE MODULES === */}
      <Section title="Carrier Scorecard" defaultOpen={false} badge={<span style={{fontSize:10,color:"#64748b",marginLeft:6}}>Performance</span>}>
        <div style={{fontSize:11,color:"#9aa8c7"}}>
          <div>Worst: <b style={{color:"#fb7185"}}>{apptMetrics.worstCarrier}</b></div>
          <div>Most Impacted Customer: <b style={{color:"#a99cff"}}>{apptMetrics.mostImpacted}</b></div>
        </div>
        <a href="/dashboard/missed-appointments" style={{fontSize:11,color:"#5539f6",textDecoration:"none",marginTop:6,display:"inline-block"}}>Full carrier analytics →</a>
      </Section>

      <Section title="SLA Analytics" defaultOpen={false} badge={<span style={{fontSize:10,color:"#64748b",marginLeft:6}}>Compliance</span>}>
        <div style={{display:"flex",gap:12,fontSize:11,color:"#9aa8c7"}}>
          <span>At Risk: <b className="warn">{metrics.slaAtRisk}</b></span>
          <span>Missed: <b className="bad">{metrics.missed}</b></span>
          <span>On Track: <b className="good">{metrics.scheduled}</b></span>
        </div>
        <a href="/dashboard/sla" style={{fontSize:11,color:"#5539f6",textDecoration:"none",marginTop:6,display:"inline-block"}}>Full SLA dashboard →</a>
      </Section>

      <Section title="Live Dock Schedule" defaultOpen={false}>
        <p style={{fontSize:11,color:"#64748b"}}>Dock assignment data not available from current WMS fields. Orders grouped under unassigned dock.</p>
      </Section>

      <Section title="Activity Feed" defaultOpen={false}>
        <a href="/dashboard/activity-log" style={{fontSize:11,color:"#5539f6",textDecoration:"none"}}>Open Activity Log →</a>
      </Section>

      <Section title="Notifications" defaultOpen={false}>
        <a href="/dashboard/notifications" style={{fontSize:11,color:"#5539f6",textDecoration:"none"}}>Open Notifications →</a>
      </Section>

      <Section title="LTL Appointments" defaultOpen={false}>
        <a href="/dashboard/ltl-appointments" style={{fontSize:11,color:"#5539f6",textDecoration:"none"}}>Open LTL Management →</a>
      </Section>

      <Section title="Tickets" defaultOpen={false}>
        <a href="/dashboard/tickets" style={{fontSize:11,color:"#5539f6",textDecoration:"none"}}>Open Ticket Queue →</a>
      </Section>
    </div>
  );
}

function Fld({l,v}:{l:string;v?:string|null}){return <div style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}><span style={{color:"#8899b4"}}>{l}</span><span style={{fontWeight:500,maxWidth:"55%",textAlign:"right",wordBreak:"break-word"}}>{v||"—"}</span></div>}
