import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js';
import { makeCommunitiesSocket } from './communities.js';
import { makeInteropSocket } from './interop.js';
import { makePrivacySocket } from './privacy.js';
import { makeGraphQLSocket } from './graphql.js';
import { makeMessageBuilderSocket } from './message-builder.js';
import { AIRichBuilder } from './ai-rich.js';

const makeWASocket = (config) => {
  const newConfig = { ...DEFAULT_CONNECTION_CONFIG, ...config };
  const base = makeCommunitiesSocket(newConfig);
  const interop = makeInteropSocket(base);
  const privacy = makePrivacySocket(interop);
  const graphql = makeGraphQLSocket(privacy);
  const sock = makeMessageBuilderSocket(graphql);
  const originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = (jid, content, options = {}) => {
    if (content && typeof content === 'object' && content.aiRich instanceof AIRichBuilder) {
      const { aiRich, forwarded, quoted, quotedParticipant, botJid, ...rest } = content;
      const built = aiRich.build({ forwarded, quoted, quotedParticipant, botJid });
      return originalSendMessage(jid, built, { ...options, ...rest });
    }
    return originalSendMessage(jid, content, options);
  };
  sock.aiRich = () => new AIRichBuilder(sock);
  return sock;
};
export default makeWASocket;
