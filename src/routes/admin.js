const express = require('express');
const db = require('../services/database');
const { formatBytes } = require('../utils/formatBytes');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const agentWs = require('../services/agent-ws');
const { buildOnlineAgentSet } = require('../utils/agentMap');
const { USER_GROUPS } = require('../utils/userGroup');

const { groupNodesByMachine } = require('../utils/nodeMachine');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  const tgEvents = {};
  ['tg_on_node_down','tg_on_node_blocked','tg_on_rotate','tg_on_abuse','tg_on_traffic','tg_on_register','tg_on_deploy'].forEach(k => {
    tgEvents[k] = db.getSetting(k) === 'true';
  });
  const allNodes = db.getAllNodes();
  const onlineAgents = buildOnlineAgentSet(agentWs.getConnectedAgents(), allNodes);
  // 每节点在线人数 Map: nodeId → count
  const { getOnlineCache } = require('../services/health');
  const onlineCache = getOnlineCache();
  const nodeOnlineCount = new Map();
  if (onlineCache.full && onlineCache.full.nodes) {
    for (const n of onlineCache.full.nodes) {
      nodeOnlineCount.set(n.nodeId, n.count || 0);
    }
  }

  res.render('admin', {
    users: [],
    nodes: allNodes,
    nodeMachines: groupNodesByMachine(allNodes),
    onlineAgents,
    nodeOnlineCount,
    logs: { rows: [], total: 0 },
    globalTraffic: db.getGlobalTraffic(),
    todayTraffic: db.getTodayTraffic(),
    usersTraffic: { rows: [], total: 0 },
    formatBytes,
    tgBotToken: db.getSetting('tg_bot_token') || '',
    tgChatId: db.getSetting('tg_chat_id') || '',
    smtpEnabled: db.getSetting('smtp_enabled') === 'true',
    smtpHost: db.getSetting('smtp_host') || '',
    smtpPort: parseInt(db.getSetting('smtp_port') || '587', 10) || 587,
    smtpSecure: db.getSetting('smtp_secure') === 'true',
    smtpUser: db.getSetting('smtp_user') || '',
    smtpFromName: db.getSetting('smtp_from_name') || 'VLESS Panel',
    smtpFromEmail: db.getSetting('smtp_from_email') || '',
    tgEvents,
    announcement: db.getSetting('announcement') || '',
    maxUsers: parseInt(db.getSetting('max_users')) || 0,
    registrationOpen: db.getSetting('registration_open') !== 'false',
    inviteRegistrationOpen: db.getSetting('invite_registration_enabled') !== 'false',
    allowedEmailDomains: db.getSetting('allowed_email_domains') || '',
    userCount: db.getUserCount(),
    defaultTrafficLimit: parseInt(db.getSetting('default_traffic_limit')),
    USER_GROUPS,
    subVisibleVless: db.getSetting('sub_visible_vless') !== 'false',
    subVisibleSs: db.getSetting('sub_visible_ss') !== 'false',
    subVisibleHy2: db.getSetting('sub_visible_hy2') !== 'false',
  });
});

module.exports = router;
