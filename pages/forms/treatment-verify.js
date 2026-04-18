import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ref, onValue } from "firebase/database";
import { wardDb } from "../../lib/firebaseConfig";
import { useAuth } from "../_app";

const WARD_STRUCTURE = {
  2: { name: "2병동", rooms: [
    { id:"201",capacity:4 },{ id:"202",capacity:1 },{ id:"203",capacity:4 },
    { id:"204",capacity:2 },{ id:"205",capacity:6 },{ id:"206",capacity:6 },
  ]},
  3: { name: "3병동", rooms: [
    { id:"301",capacity:4 },{ id:"302",capacity:1 },{ id:"303",capacity:4 },
    { id:"304",capacity:2 },{ id:"305",capacity:2 },{ id:"306",capacity:6 },
  ]},
  5: { name: "5병동", rooms: [
    { id:"501",capacity:4 },{ id:"502",capacity:1 },{ id:"503",capacity:4 },
    { id:"504",capacity:2 },{ id:"505",capacity:6 },{ id:"506",capacity:6 },
  ]},
  6: { name: "6병동", rooms: [
    { id:"601",capacity:6 },{ id:"602",capacity:1 },{ id:"603",capacity:6 },
  ]},
};

const TREATMENT_GROUPS = [
  { group:"고주파 온열치료", color:"#dc2626", bg:"#fef2f2",
    items:[{ id:"hyperthermia", name:"고주파 온열치료" }, { id:"hyperbaric", name:"고압산소치료" }] },
  { group:"싸이모신알파1", color:"#7c3aed", bg:"#faf5ff",
    items:[{ id:"zadaxin",name:"자닥신" },{ id:"imualpha",name:"이뮤알파" },{ id:"scion",name:"싸이원주" }] },
  { group:"수액류", color:"#0ea5e9", bg:"#f0f9ff",
    items:[
      { id:"glutathione",name:"글루타치온" },{ id:"dramin",name:"닥터라민+지씨멀티주" },
      { id:"thioctic",name:"티옥트산" },{ id:"gt",name:"G+T" },
      { id:"myers1",name:"마이어스1" },{ id:"myers2",name:"마이어스2" },
      { id:"selenium_iv",name:"셀레늄" },{ id:"vitd",name:"비타민D" },
      { id:"vitc",name:"고용량 비타민C",custom:"vitc" },
    ] },
  { group:"물리치료", color:"#059669", bg:"#f0fdf4",
    items:[{ id:"pain",name:"페인스크렘블러" },{ id:"manip2",name:"도수치료2" },{ id:"manip1",name:"도수치료1" }] },
  { group:"경구제", color:"#d97706", bg:"#fffbeb",
    items:[
      { id:"meshima",name:"메시마F",custom:"qty" },{ id:"selenase_l",name:"셀레나제액상",custom:"qty" },
      { id:"selenase_t",name:"셀레나제정",custom:"qty" },{ id:"selenase_f",name:"셀레나제필름",custom:"qty" },
    ] },
];

const ALL_ITEMS = TREATMENT_GROUPS.flatMap(g => g.items);
const DAY_KO = ["일","월","화","수","목","금","토"];

const ATT_COLORS = {
  "강국형": { bg:"#dbeafe", fg:"#1d4ed8", border:"#60a5fa" },
  "이숙경": { bg:"#fce7f3", fg:"#be185d", border:"#f472b6" },
};

function pad(n) { return String(n).padStart(2, "0"); }
function toMK(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }
function toDK(d) { return String(d.getDate()); }
function toISOLocal(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

function parseAdmitDate(str) {
  if (!str || str === "미정") return null;
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) { const d = new Date(+iso[1], +iso[2]-1, +iso[3]); d.setHours(0,0,0,0); return d; }
  const m = str.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const now = new Date();
    let y = now.getFullYear();
    const d = new Date(y, +m[1]-1, +m[2]);
    if (d.getTime() > now.getTime() + 7*24*3600*1000) { d.setFullYear(y-1); }
    d.setHours(0,0,0,0);
    return d;
  }
  return null;
}

// 주 시작(월요일)
function getMonday(d) {
  const x = new Date(d);
  const dw = x.getDay();
  x.setDate(x.getDate() + (dw === 0 ? -6 : 1 - dw));
  x.setHours(0,0,0,0);
  return x;
}

function formatSyncAgo(iso) {
  if (!iso) return "아직 없음";
  const diff = Date.now() - new Date(iso).getTime();
  if (!isFinite(diff) || diff < 0) return "—";
  const min = Math.round(diff / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(iso).toLocaleString("ko-KR");
}

export default function TreatmentVerify() {
  useAuth(); // 로그인 체크 트리거
  const today = new Date(); today.setHours(0,0,0,0);
  const [weekStart, setWeekStart] = useState(() => getMonday(today));
  const [slots, setSlots] = useState({});
  const [treatPlans, setTreatPlans] = useState({});
  const [emrSyncTime, setEmrSyncTime] = useState(null);
  const [roomSyncTime, setRoomSyncTime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterAttending, setFilterAttending] = useState(null);
  const [filterGroup, setFilterGroup] = useState(null);

  useEffect(() => {
    const unsubS = onValue(ref(wardDb, "slots"), snap => setSlots(snap.val() || {}));
    const unsubT = onValue(ref(wardDb, "treatmentPlans"), snap => { setTreatPlans(snap.val() || {}); setLoading(false); });
    const unsubE = onValue(ref(wardDb, "emrSyncLog/lastSync"), snap => setEmrSyncTime(snap.val()));
    const unsubR = onValue(ref(wardDb, "roomSyncLog/lastSync"), snap => setRoomSyncTime(snap.val()));
    return () => { unsubS(); unsubT(); unsubE(); unsubR(); };
  }, []);

  // 주 7일 날짜 목록
  const weekDates = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [weekStart]);

  const weekEnd = weekDates[6];

  // 치료별·날짜별 불일치 집계 (매트릭스)
  const { mismatchMatrix, itemIds, emrSummary, attCounts, unassignedCount } = useMemo(() => {
    // matrix[itemId][dateISO] = { plus:[], minus:[], room:[] }
    //   plus  = 치료실입력 미입력 (EMR엔 있는데 치료계획 없음)
    //   minus = EMR 미반영 (치료계획엔 있는데 EMR 없음)
    //   room  = 치료실 제거 (오늘/미래만)
    const matrix = {};
    const summary = { match:0, plus:0, minus:0, room:0 };

    for (const sk of Object.keys(slots)) {
      const current = slots[sk]?.current;
      if (!current?.name) continue;
      const attending = current?.attending || "";
      if (filterAttending && attending !== filterAttending) continue;

      const admit = parseAdmitDate(current.admitDate);

      for (const d of weekDates) {
        if (admit && d < admit) continue;
        const items = treatPlans[sk]?.[toMK(d)]?.[toDK(d)];
        if (!items) continue;
        const isPast = d < today;
        const dateISO = toISOLocal(d);
        for (const e of items) {
          if (e.room === "removed" && isPast) continue;
          const type = e.room === "removed" ? "room" :
            e.emr === "match" ? "match" :
            (e.emr === "added" || e.emr === "modified") ? "plus" :
            (e.emr === "removed" || e.emr === "missing") ? "minus" : null;
          if (!type) continue;
          summary[type]++;
          if (type === "match") continue;
          if (filterGroup) {
            const grp = TREATMENT_GROUPS.find(g => g.group === filterGroup);
            if (!grp || !grp.items.some(i => i.id === e.id)) continue;
          }
          if (!matrix[e.id]) matrix[e.id] = {};
          if (!matrix[e.id][dateISO]) matrix[e.id][dateISO] = { plus:[], minus:[], room:[] };
          const [rid, bed] = sk.split("-");
          matrix[e.id][dateISO][type].push({
            slotKey: sk, roomId: rid, bedNum: bed,
            patientName: current.name, attending,
          });
        }
      }
    }

    // 주치의별 집계 (주 전체 기준, 필터 무관)
    const fullAtt = { "강국형":new Set(), "이숙경":new Set(), "":new Set() };
    for (const sk of Object.keys(slots)) {
      const current = slots[sk]?.current;
      if (!current?.name) continue;
      const admit = parseAdmitDate(current.admitDate);
      let hasWeekPlan = false;
      for (const d of weekDates) {
        if (admit && d < admit) continue;
        if (treatPlans[sk]?.[toMK(d)]?.[toDK(d)]?.length) { hasWeekPlan = true; break; }
      }
      if (!hasWeekPlan) continue;
      const att = current.attending || "";
      if (fullAtt[att]) fullAtt[att].add(sk);
    }

    const itemOrder = Object.fromEntries(ALL_ITEMS.map((it, i) => [it.id, i]));
    // 셀 내부 환자 배열은 병실순으로 정렬
    for (const itemId of Object.keys(matrix)) {
      for (const dk of Object.keys(matrix[itemId])) {
        for (const kind of ["plus","minus","room"]) {
          matrix[itemId][dk][kind].sort((a,b) => a.roomId.localeCompare(b.roomId));
        }
      }
    }
    const sortedIds = Object.keys(matrix).sort((a, b) => (itemOrder[a] ?? 999) - (itemOrder[b] ?? 999));

    return {
      mismatchMatrix: matrix,
      itemIds: sortedIds,
      emrSummary: summary,
      attCounts: [
        { att:"강국형", count: fullAtt["강국형"].size },
        { att:"이숙경", count: fullAtt["이숙경"].size },
      ].filter(a => a.count > 0),
      unassignedCount: fullAtt[""].size,
    };
  }, [slots, treatPlans, weekDates, filterAttending, filterGroup, today]);

  const filterGroupCandidates = useMemo(() => {
    const set = new Set();
    for (const itemId of itemIds) {
      const grp = TREATMENT_GROUPS.find(g => g.items.some(i => i.id === itemId));
      if (grp) set.add(grp.group);
    }
    return TREATMENT_GROUPS.filter(g => set.has(g.group));
  }, [itemIds]);

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate()-7); setWeekStart(d); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate()+7); setWeekStart(d); };
  const thisWeek = () => setWeekStart(getMonday(today));

  const isThisWeek = weekStart.getTime() === getMonday(today).getTime();
  const weekLabel = `${weekStart.getMonth()+1}/${weekStart.getDate()}(${DAY_KO[weekStart.getDay()]}) ~ ${weekEnd.getMonth()+1}/${weekEnd.getDate()}(${DAY_KO[weekEnd.getDay()]})`;

  const isSameDay = (a, b) => a.getTime() === b.getTime();

  return (
    <div style={S.page}>
      <header style={S.header}>
        <Link href="/" style={S.back}>← 돌아가기</Link>
        <div style={S.titleWrap}>
          <div style={S.title}>치료계획 / EMR 검증</div>
          <div style={S.sub}>주간 불일치 현황</div>
        </div>
        <div style={S.nav}>
          <button style={S.navBtn} onClick={prevWeek}>‹ 이전</button>
          <div style={S.weekLabel}>{weekLabel}</div>
          <button style={S.navBtn} onClick={nextWeek}>다음 ›</button>
          {!isThisWeek && <button style={{...S.navBtn, background:"#065f46", color:"#6ee7b7"}} onClick={thisWeek}>이번 주</button>}
        </div>
      </header>

      <div style={S.topBar}>
        <div style={S.totalBox}>
          <div style={S.totalMain}>
            <strong style={{color:"#0ea5e9", fontSize:20}}>{itemIds.length}</strong>개 치료 불일치
          </div>
          <div style={S.totalSub}>
            <span style={{color:"#10b981"}}>EMR {emrSummary.match}</span>
            <span style={{color:"#3b82f6"}}>EMR+ {emrSummary.plus}</span>
            <span style={{color:"#ef4444"}}>EMR- {emrSummary.minus}</span>
            {emrSummary.room > 0 && <span style={{color:"#7c2d12"}}>치료실- {emrSummary.room}</span>}
          </div>
        </div>
        <div style={S.syncBox}>
          <div>EMR 동기화 <strong>{formatSyncAgo(emrSyncTime)}</strong></div>
          <div>치료실 동기화 <strong>{formatSyncAgo(roomSyncTime)}</strong></div>
        </div>
      </div>

      <div style={S.filterBar}>
        <div style={S.filterLine}>
          <span style={S.filterLabel}>주치의</span>
          <button style={{...S.filterBtn, ...(filterAttending===null ? S.filterBtnActive : {})}}
            onClick={() => setFilterAttending(null)}>전체</button>
          {attCounts.map(a => {
            const c = ATT_COLORS[a.att] || {bg:"#f1f5f9", fg:"#334155", border:"#cbd5e1"};
            const active = filterAttending === a.att;
            return (
              <button key={a.att}
                style={{...S.filterBtn, background: active ? c.fg : c.bg, color: active ? "#fff" : c.fg, borderColor: c.border}}
                onClick={() => setFilterAttending(active ? null : a.att)}>
                {a.att} ({a.count})
              </button>
            );
          })}
          {unassignedCount > 0 && <span style={{fontSize:11, color:"#94a3b8", marginLeft:4}}>미지정 {unassignedCount}명</span>}
        </div>
        {filterGroupCandidates.length > 0 && (
          <div style={S.filterLine}>
            <span style={S.filterLabel}>치료군</span>
            <button style={{...S.filterBtn, ...(filterGroup===null ? S.filterBtnActive : {})}}
              onClick={() => setFilterGroup(null)}>전체</button>
            {filterGroupCandidates.map(g => {
              const active = filterGroup === g.group;
              return (
                <button key={g.group}
                  style={{...S.filterBtn, background: active ? g.color : g.bg, color: active ? "#fff" : g.color, borderColor: g.color}}
                  onClick={() => setFilterGroup(active ? null : g.group)}>
                  {g.group}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <main style={S.main}>
        {loading ? (
          <div style={S.empty}>불러오는 중...</div>
        ) : itemIds.length === 0 ? (
          <div style={S.empty}>이 주는 불일치 항목이 없습니다. ✓</div>
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.thCorner}>치료</th>
                  {weekDates.map((d, i) => {
                    const isToday = isSameDay(d, today);
                    const isPast = d < today;
                    const dow = d.getDay();
                    return (
                      <th key={i} style={{
                        ...S.thDate,
                        ...(isToday ? S.thToday : {}),
                        ...(isPast && !isToday ? S.thPast : {}),
                        ...(dow === 0 ? { color:"#dc2626" } : dow === 6 ? { color:"#2563eb" } : {}),
                      }}>
                        <div style={S.thDateNum}>{d.getMonth()+1}/{d.getDate()}</div>
                        <div style={S.thDay}>({DAY_KO[dow]})</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {itemIds.map(itemId => {
                  const item = ALL_ITEMS.find(i => i.id === itemId);
                  const grp = TREATMENT_GROUPS.find(g => g.items.some(i => i.id === itemId));
                  return (
                    <tr key={itemId}>
                      <td style={{...S.tdItem, color: grp?.color, background: grp?.bg, borderLeftColor: grp?.color}}>
                        {item?.name || itemId}
                      </td>
                      {weekDates.map((d, i) => {
                        const dateISO = toISOLocal(d);
                        const cell = mismatchMatrix[itemId]?.[dateISO];
                        const isToday = isSameDay(d, today);
                        const isPast = d < today;
                        return (
                          <td key={i} style={{
                            ...S.tdCell,
                            ...(isToday ? S.tdCellToday : {}),
                            ...(isPast && !isToday ? S.tdCellPast : {}),
                          }}>
                            {cell && (cell.plus.length > 0 || cell.minus.length > 0 || cell.room.length > 0) ? (
                              <div style={S.cellStack}>
                                {cell.plus.length > 0 && (
                                  <div style={S.cellSectionPlus}>
                                    {cell.plus.map((p, idx) => (
                                      <PatChip key={`p${idx}`} p={p} type="plus" />
                                    ))}
                                  </div>
                                )}
                                {cell.room.length > 0 && (
                                  <div style={S.cellSectionRoom}>
                                    {cell.room.map((p, idx) => (
                                      <PatChip key={`r${idx}`} p={p} type="room" />
                                    ))}
                                  </div>
                                )}
                                {cell.minus.length > 0 && (
                                  <div style={S.cellSectionMinus}>
                                    {cell.minus.map((p, idx) => (
                                      <PatChip key={`m${idx}`} p={p} type="minus" />
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={S.legend}>
              <span style={{...S.legendItem, background:"#dbeafe", color:"#1e40af", borderColor:"#60a5fa"}}>
                위 · 치료실입력 미입력 (EMR+)
              </span>
              <span style={{...S.legendItem, background:"#fee2e2", color:"#991b1b", borderColor:"#fca5a5"}}>
                아래 · EMR 미반영 (EMR-)
              </span>
              {emrSummary.room > 0 && (
                <span style={{...S.legendItem, background:"#fef3c7", color:"#92400e", borderColor:"#fbbf24"}}>
                  치료실 제거
                </span>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function PatChip({ p, type }) {
  const bg = type === "plus" ? "#dbeafe" : type === "room" ? "#fef3c7" : "#fee2e2";
  const fg = type === "plus" ? "#1e40af" : type === "room" ? "#92400e" : "#991b1b";
  const bd = type === "plus" ? "#60a5fa" : type === "room" ? "#fbbf24" : "#fca5a5";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:3, background:bg, color:fg,
      border:`1px solid ${bd}`, borderRadius:5, padding:"1px 4px", fontSize:10, fontWeight:700, lineHeight:1.3 }}>
      <span style={{ background:fg, color:"#fff", borderRadius:3, padding:"0 3px", fontSize:9 }}>
        {p.roomId}-{p.bedNum}
      </span>
      <span>{p.patientName}</span>
      {p.attending && ATT_COLORS[p.attending] && (
        <span style={{
          background: ATT_COLORS[p.attending].fg, color:"#fff",
          borderRadius:3, padding:"0 3px", fontSize:8, fontWeight:800
        }}>
          {p.attending[0]}
        </span>
      )}
    </span>
  );
}

const S = {
  page: { fontFamily:"'Noto Sans KR','Pretendard',sans-serif", background:"#f0f4f8", minHeight:"100vh", color:"#0f172a" },
  header: { background:"#0f2744", color:"#fff", padding:"14px 20px", display:"flex", alignItems:"center", gap:16, flexWrap:"wrap", boxShadow:"0 2px 12px rgba(0,0,0,0.15)" },
  back: { background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", color:"#fff", borderRadius:7, padding:"6px 14px", fontSize:13, fontWeight:600, textDecoration:"none" },
  titleWrap: { flex:1, textAlign:"center" },
  title: { fontSize:18, fontWeight:800 },
  sub: { fontSize:12, color:"#7dd3fc", marginTop:2 },
  nav: { display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" },
  navBtn: { background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", color:"#e2e8f0", borderRadius:7, padding:"5px 12px", cursor:"pointer", fontSize:12, fontWeight:600 },
  weekLabel: { fontSize:13, fontWeight:700, minWidth:180, textAlign:"center" },

  topBar: { background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"10px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 },
  totalBox: { display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" },
  totalMain: { fontSize:14, fontWeight:700 },
  totalSub: { display:"flex", gap:10, fontSize:12, fontWeight:700 },
  syncBox: { fontSize:12, color:"#64748b", fontWeight:600 },

  filterBar: { background:"#f8fafc", borderBottom:"1px solid #e2e8f0", padding:"10px 20px", display:"flex", flexDirection:"column", gap:6 },
  filterLine: { display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" },
  filterLabel: { fontSize:12, fontWeight:700, color:"#475569", marginRight:4 },
  filterBtn: { border:"1.5px solid #e2e8f0", borderRadius:7, padding:"3px 10px", cursor:"pointer", fontSize:12, fontWeight:700, background:"#f1f5f9", color:"#64748b" },
  filterBtnActive: { background:"#0f2744", color:"#fff", borderColor:"#0f2744" },

  main: { padding:"20px" },
  empty: { textAlign:"center", color:"#94a3b8", fontSize:15, marginTop:60 },

  tableWrap: { overflowX:"auto", background:"#fff", borderRadius:10, border:"1px solid #e2e8f0", boxShadow:"0 1px 3px rgba(0,0,0,0.04)" },
  table: { width:"100%", borderCollapse:"separate", borderSpacing:0, minWidth:720 },
  thCorner: { position:"sticky", left:0, top:0, zIndex:3, background:"#0f2744", color:"#fff",
    fontSize:12, fontWeight:800, padding:"10px 12px", textAlign:"center", borderBottom:"2px solid #0f2744",
    minWidth:130, width:130 },
  thDate: { position:"sticky", top:0, zIndex:2, background:"#0f2744", color:"#e2e8f0",
    fontSize:12, fontWeight:700, padding:"8px 4px", textAlign:"center",
    borderLeft:"1px solid rgba(255,255,255,0.15)", borderBottom:"2px solid #0f2744", minWidth:110 },
  thToday: { background:"#0369a1", color:"#fff" },
  thPast: { background:"#334155", color:"#cbd5e1" },
  thDateNum: { fontSize:13, fontWeight:800 },
  thDay: { fontSize:10, fontWeight:700, opacity:0.85, marginTop:1 },

  tdItem: { position:"sticky", left:0, zIndex:1, fontSize:12, fontWeight:800, textAlign:"center",
    padding:"8px 10px", borderBottom:"1px solid #e2e8f0", borderLeft:"3px solid transparent",
    minWidth:130, width:130, background:"#fff" },
  tdCell: { verticalAlign:"top", padding:4, borderBottom:"1px solid #e2e8f0",
    borderLeft:"1px solid #e2e8f0", minWidth:110, background:"#fff" },
  tdCellToday: { background:"#f0f9ff" },
  tdCellPast: { background:"#f8fafc" },

  cellStack: { display:"flex", flexDirection:"column", gap:3 },
  cellSectionPlus: { display:"flex", flexWrap:"wrap", gap:2 },
  cellSectionMinus: { display:"flex", flexWrap:"wrap", gap:2 },
  cellSectionRoom: { display:"flex", flexWrap:"wrap", gap:2 },

  legend: { display:"flex", gap:8, flexWrap:"wrap", padding:"10px 14px", borderTop:"1px solid #e2e8f0", background:"#f8fafc" },
  legendItem: { fontSize:11, fontWeight:700, border:"1px solid", borderRadius:6, padding:"3px 8px" },
};
