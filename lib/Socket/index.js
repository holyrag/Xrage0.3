import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js';
import { makeCommunitiesSocket } from './communities.js';
import { makeInteropSocket } from './interop.js';
import { makePrivacySocket } from './privacy.js';
import { makeGraphQLSocket } from './graphql.js';
import { makeMessageBuilderSocket } from './message-builder.js';
import { AIRichBuilder } from './ai-rich.js';
import { SendGuard, SendAnalytics } from './send-guard-analytics.js';

const makeWASocket = (config) => {
  const newConfig = { ...DEFAULT_CONNECTION_CONFIG, ...config };
  const base = makeCommunitiesSocket(newConfig);
  const interop = makeInteropSocket(base);
  const privacy = makePrivacySocket(interop);
  const graphql = makeGraphQLSocket(privacy);
  const sock = makeMessageBuilderSocket(graphql);
  const originalSendMessage = sock.sendMessage.bind(sock);
  const sendGuard = new SendGuard(newConfig.sendGuard || {});
  const analytics = new SendAnalytics();
  sock.sendMessage = async (jid, content, options = {}) => {
    let outgoing = content;
    let sendOptions = options;
    if (content && typeof content === 'object' && content.aiRich instanceof AIRichBuilder) {
      const { aiRich, forwarded, quoted, quotedParticipant, botJid, ...rest } = content;
      outgoing = aiRich.build({ forwarded, quoted, quotedParticipant, botJid });
      sendOptions = { ...options, ...rest };
    }
    const signature = JSON.stringify(outgoing, (_key, value) =>
      value instanceof Uint8Array ? `bytes:${value.byteLength}` : value
    );
    await sendGuard.gate(jid, signature);
    try {
      const result = await originalSendMessage(jid, outgoing, sendOptions);
      analytics.record(jid, outgoing, result, null);
      sock.ev?.emit?.('send.analytics', analytics.snapshot());
      return result;
    } catch (error) {
      analytics.record(jid, outgoing, null, error);
      sock.ev?.emit?.('send.analytics', analytics.snapshot());
      throw error;
    }
  };
  sock.postToChannel = (jid, content, options = {}) => {
    if (!String(jid).endsWith('@newsletter')) {
      throw new TypeError('Channel JID must end with @newsletter');
    }
    return sock.sendMessage(jid, content, options);
  };
  sock.postStatus = (content, options = {}) =>
    sock.sendMessage('status@broadcast', content, options);
  sock.getSendAnalytics = () => analytics.snapshot();
  sock.getChannelAnalytics = (jid, count = 50, after, since) => {
    if (!String(jid).endsWith('@newsletter')) {
      throw new TypeError('Channel JID must end with @newsletter');
    }
    if (typeof sock.newsletterFetchUpdates !== 'function') {
      throw new Error('Channel analytics are not available in this socket build');
    }
    return sock.newsletterFetchUpdates(jid, count, after, since);
  };
  sock.resetSendAnalytics = () => analytics.reset();
  sock.aiRich = () => new AIRichBuilder(sock);
  return sock;
};
export default makeWASocket;
