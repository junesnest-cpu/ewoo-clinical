/**
 * 보안 이벤트 로깅 — ward RTDB `securityEvents/{YYYY-MM-DD}/{push-id}` 에 누적.
 *
 * 3프로젝트(hospital/approval/clinical) 통합 저장 — ewoo-hospital/lib/securityLog.js 참조.
 * clinical 자체 DB 는 Firestore 라 RTDB push 패턴 호환 안 됨 → ward RTDB 사용.
 *
 * fail-safe: wardAdminDb null 또는 write 실패 시 console.warn 만 남기고 통과.
 */
import { wardAdminDb } from './firebaseAdmin';

const PROJECT = 'clinical';

export async function logSecurityEvent(event) {
  if (!wardAdminDb || !event?.type) return;
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10);
  try {
    await wardAdminDb.ref(`securityEvents/${ymd}`).push({
      project: PROJECT,
      ts: now.getTime(),
      ...event,
    });
  } catch (e) {
    console.warn(`[securityLog] write failed (${event.type}): ${e.message}`);
  }
}
