/**
 * Conservative outbound-send guard and lightweight local analytics.
 * This reduces accidental bursts and duplicate sends; it cannot guarantee
 * that WhatsApp will not restrict an account.
 */
export class SendGuardError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SendGuardError';
    this.code = code;
  }
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export class SendGuard {
  constructor(options = {}) {
    this.options = {
      enabled: true,
      maxPerMinute: 20,
      maxPerHour: 100,
      maxPerDay: 500,
      maxIdenticalMessages: 3,
      identicalWindowMs: HOUR,
      minDelayMs: 1500,
      maxDelayMs: 3000,
      newChatDelayMs: 1000,
      ...options,
    };
    this.sent = [];
    this.identical = new Map();
    this.lastSentAt = 0;
    this.chats = new Set();
    this.tail = Promise.resolve();
  }

  gate(chat, signature) {
    if (!this.options.enabled) return Promise.resolve();
    const run = this.tail.then(() => this._gate(chat, signature));
    this.tail = run.catch(() => {});
    return run;
  }

  async _gate(chat, signature) {
    const now = Date.now();
    this._prune(now);
    const o = this.options;
    if (this._count(now, DAY) >= o.maxPerDay)
      throw new SendGuardError('Daily outbound message limit reached', 'daily-limit');
    if (this._count(now, HOUR) >= o.maxPerHour)
      throw new SendGuardError('Hourly outbound message limit reached', 'hourly-limit');
    const duplicates = this.identical.get(signature) || [];
    if (duplicates.length >= o.maxIdenticalMessages)
      throw new SendGuardError('Repeated identical message limit reached', 'duplicate-limit');

    const minute = this.sent.filter(t => now - t < MINUTE);
    if (minute.length >= o.maxPerMinute) {
      const wait = minute[0] + MINUTE - now + 5;
      await new Promise(resolve => setTimeout(resolve, wait));
    }

    const current = Date.now();
    const randomGap = o.minDelayMs + Math.random() * Math.max(0, o.maxDelayMs - o.minDelayMs);
    const gap = this.lastSentAt ? Math.max(0, randomGap - (current - this.lastSentAt)) : 0;
    const newChatPause = this.chats.has(chat) ? 0 : o.newChatDelayMs;
    const wait = Math.max(gap, newChatPause);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));

    const sentAt = Date.now();
    this.lastSentAt = sentAt;
    this.chats.add(chat);
    this.sent.push(sentAt);
    this.identical.set(signature, [...duplicates, sentAt]);
  }

  _count(now, windowMs) {
    return this.sent.filter(t => now - t < windowMs).length;
  }

  _prune(now) {
    this.sent = this.sent.filter(t => now - t < DAY);
    for (const [key, values] of this.identical) {
      const recent = values.filter(t => now - t < this.options.identicalWindowMs);
      if (recent.length) this.identical.set(key, recent);
      else this.identical.delete(key);
    }
  }
}

export class SendAnalytics {
  constructor() {
    this.reset();
  }

  record(jid, content, result, error) {
    const kind = jid === 'status@broadcast'
      ? 'status'
      : (String(jid).endsWith('@newsletter') ? 'channel' : 'message');
    this.totals.attempted++;
    this.totals[kind].attempted++;
    if (error) {
      this.totals.failed++;
      this.totals[kind].failed++;
    } else {
      this.totals.sent++;
      this.totals[kind].sent++;
    }
    this.recent.unshift({
      at: new Date().toISOString(),
      jid,
      kind,
      success: !error,
      messageId: result?.key?.id || result?.messageId || null,
      error: error ? String(error.message || error) : undefined,
    });
    if (this.recent.length > 200) this.recent.length = 200;
  }

  snapshot() {
    return JSON.parse(JSON.stringify({
      ...this.totals,
      recent: this.recent,
    }));
  }

  reset() {
    this.totals = {
      attempted: 0, sent: 0, failed: 0,
      message: { attempted: 0, sent: 0, failed: 0 },
      status: { attempted: 0, sent: 0, failed: 0 },
      channel: { attempted: 0, sent: 0, failed: 0 },
    };
    this.recent = [];
  }
}
