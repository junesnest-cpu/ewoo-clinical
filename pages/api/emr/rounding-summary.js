/**
 * 병동 라운딩 요약 API
 * GET /api/emr/rounding-summary
 *
 * 기존 /api/emr/opinion-data 프록시를 재활용하여
 * 전체 입원환자의 최근 SOAP S + 업무메모를 조회
 * → 라즈베리파이 프록시 수정 불필요
 */

const EMR_PROXY_URL = process.env.EMR_PROXY_URL;
const EMR_PROXY_KEY = process.env.EMR_PROXY_KEY || 'ewoo-emr-2026';

// 동시 요청 제한 (라즈베리파이 부하 방지)
const CONCURRENCY = 5;

async function fetchOpinionData(chartNo) {
  const r = await fetch(`${EMR_PROXY_URL}/api/emr/opinion-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': EMR_PROXY_KEY },
    body: JSON.stringify({ chartNo }),
  });
  if (!r.ok) return null;
  return r.json();
}

async function runWithConcurrency(tasks, limit) {
  const results = [];
  let idx = 0;
  async function next() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => next()));
  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  if (!EMR_PROXY_URL) {
    return res.status(503).json({ error: 'EMR proxy not configured' });
  }

  try {
    // 1) 현재 입원환자 목록 (rounding API에서)
    // Firestore roundingSync 또는 EMR 직접 조회
    let chartNos = [];
    try {
      const { adminDb } = await import('../../../lib/firebaseAdmin');
      const dateKey = new Date().toISOString().slice(0, 10);
      const snap = await adminDb.doc(`roundingSync/${dateKey}`).get();
      if (snap.exists) {
        chartNos = (snap.data().patients || []).map(p => p.chartNo).filter(Boolean);
      }
    } catch (e) {}

    // Firestore에 없으면 EMR 프록시의 rounding 데이터 사용
    if (!chartNos.length) {
      try {
        const r = await fetch(`${EMR_PROXY_URL}/api/emr/rounding`, {
          headers: { 'x-api-key': EMR_PROXY_KEY },
        });
        if (r.ok) {
          const data = await r.json();
          chartNos = (data.patients || []).map(p => p.chartNo).filter(Boolean);
        }
      } catch (e) {}
    }

    if (!chartNos.length) {
      return res.json({ patients: {} });
    }

    // 2) 각 환자의 opinion-data를 병렬 조회 (동시 5건 제한)
    const tasks = chartNos.map(chartNo => () => fetchOpinionData(chartNo));
    const results = await runWithConcurrency(tasks, CONCURRENCY);

    // 3) 최근 SOAP S + 업무메모만 추출
    const patients = {};
    for (let i = 0; i < chartNos.length; i++) {
      const data = results[i];
      if (!data) { patients[chartNos[i]] = { soapS: null, workMemo: null, jumin: '' }; continue; }

      // 최근 SOAP S (progressNotes 배열의 첫 번째 = 최신)
      const latestNote = (data.progressNotes || [])[0];
      const soapS = latestNote?.S ? { date: latestNote.date, text: latestNote.S } : null;

      // 최근 업무메모 (workMemos 배열의 첫 번째 = 최신)
      const latestMemo = (data.workMemos || [])[0];
      const workMemo = latestMemo ? { date: latestMemo.date, memo: latestMemo.memo, author: latestMemo.author } : null;

      patients[chartNos[i]] = {
        jumin: data.basic?.jumin || '',
        soapS,
        workMemo,
      };
    }

    return res.json({ patients });
  } catch (err) {
    console.error('Rounding summary error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
