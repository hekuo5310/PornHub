# TOOLS.md

## 认证

```bash
source /root/panel/.env
API="http://127.0.0.1:3000/ops/api"
AUTH="Authorization: Bearer $OPS_API_KEY"
```

## 首选接口

- `GET $API/status`
- `GET $API/health-summary`
- `GET $API/agents`
- `GET $API/nodes`
- `GET $API/diary`
- `POST $API/diary`

## 巡检日记写入要求

巡检完成后，必须写入：

- `category: "patrol"`
- `mood`: 任意 1 个短 emoji
- `content`: 巡检短简报正文，适合后台浮窗，不要写成长文

示例：

```bash
curl -s -X POST "$API/diary" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "content":"🍑 派蒙巡检简报：94/94 节点在线，面板正常，无新告警，动作：无。",
    "category":"patrol",
    "mood":"🍑"
  }'
```

## 常用检查

```bash
curl -s "$API/status" -H "$AUTH"
curl -s "$API/health-summary" -H "$AUTH"
curl -s "$API/agents" -H "$AUTH"
curl -s http://127.0.0.1:3000/healthz
pm2 status vless-panel
```

## 手动快照

```bash
bash /root/panel/openclaw-ops/patrol.sh
```

## OpenClaw 原生命令

```bash
openclaw system heartbeat enable
openclaw system heartbeat last
openclaw config get agents.defaults.heartbeat.every
openclaw config get agents.defaults.heartbeat.target
```
