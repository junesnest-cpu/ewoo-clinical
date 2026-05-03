/**
 * Rate limit / dedup 유틸 (Firebase RTDB 기반).
 * ewoo-hospital/lib/rateLimit.js 와 동일.
 */
import { logSecurityEvent } from './securityLog';

export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'] || '';
  const ip = (xff.split(',')[0] || '').trim() || req.socket?.remoteAddress || 'unknown';
  return sanitizeKey(ip);
}

export function sanitizeKey(s) {
  return String(s || '').replace(/[.#$\[\]\/]/g, '_').replace(/:/g, '_');
}

export async function checkRateLimit({ key, max, windowMs, db }) {
  if (!db) {
    console.warn('[rateLimit] db missing — fail-open');
    return { allowed: true, count: 0 };
  }
  const ref = db.ref(`rateLimits/${key}`);
  const now = Date.now();
  const windowStart = now - windowMs;

  let entries;
  try {
    const snap = await ref.once('value');
    entries = snap.val() || {};
  } catch (e) {
    console.warn(`[rateLimit] read failed for ${key}: ${e.message} — fail-open`);
    return { allowed: true, count: 0 };
  }

  const allTimes = Object.keys(entries).map(Number).filter(Number.isFinite);
  const recentTimes = allTimes.filter(t => t > windowStart);

  if (recentTimes.length >= max) {
    const oldest = Math.min(...recentTimes);
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    logSecurityEvent({
      type: 'rate-limit-hit',
      key, max, windowMs, count: recentTimes.length, retryAfter,
    });
    return { allowed: false, retryAfter, count: recentTimes.length };
  }

  try {
    await ref.child(String(now)).set(true);
  } catch (e) {
    console.warn(`[rateLimit] write failed for ${key}: ${e.message} — fail-open`);
  }

  const expired = allTimes.filter(t => t <= windowStart);
  if (expired.length > 0) {
    const updates = {};
    for (const t of expired) updates[String(t)] = null;
    ref.update(updates).catch(() => {});
  }

  return { allowed: true, count: recentTimes.length + 1 };
}
