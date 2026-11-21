#!/bin/bash
# 手动巡检快照脚本
# 仅供人工排查时快速采样，不参与 OpenClaw 原生 heartbeat 调度
# 原则：优先通过 OPS API 获取数据，不直接查 DB

set -e
PANEL_DIR="${PANEL_DIR:-/root/panel}"
PANEL_URL="${PANEL_URL:-http://127.0.0.1:3000}"
OPS_API_KEY="${OPS_API_KEY:-}"

# OPS API 请求封装
ops_api() {
  local endpoint="$1"
  if [ -z "$OPS_API_KEY" ]; then
    echo "❌ OPS_API_KEY 未配置" >&2
    return 1
  fi
  curl -sf --max-time 10 \
    -H "Authorization: Bearer $OPS_API_KEY" \
    "${PANEL_URL}/ops/api${endpoint}" 2>/dev/null
}

# jq 字段提取（兼容无 jq 环境用 node 替代）
json_get() {
  local json="$1" expr="$2"
  if command -v jq >/dev/null 2>&1; then
    echo "$json" | jq -r "$expr" 2>/dev/null
  else
    echo "$json" | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        try{const o=JSON.parse(d);const r=Function('o','return o'+process.argv[1])(o);
        if(Array.isArray(r))r.forEach(x=>console.log(typeof x==='object'?JSON.stringify(x):x));
        else console.log(r==null?'':r);}catch(e){console.log('');}
      });" "$(echo "$expr" | sed 's/^\.//')" 2>/dev/null
  fi
}

echo "========== 🍑 派蒙巡检报告 =========="
echo "时间: $(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 1. 面板状态
echo "📋 面板状态:"
pm2 jlist 2>/dev/null | python3 -c "
import json,sys
data=json.load(sys.stdin)
for p in data:
  if p['name']=='vless-panel':
    print(f\"  状态: {p['pm2_env']['status']}\")
    print(f\"  重启次数: {p['pm2_env']['restart_time']}\")
    print(f\"  内存: {p['monit']['memory']//1024//1024}MB\")
    print(f\"  CPU: {p['monit']['cpu']}%\")
    print(f\"  运行时间: {p['pm2_env']['pm_uptime']}ms since epoch\")
" 2>/dev/null || echo "  ❌ PM2 查询失败"

# 2. 最近错误日志
echo ""
echo "📝 最近错误 (最后5条):"
tail -5 "$PANEL_DIR/data/logs/error.log" 2>/dev/null | grep -v "ERR_ERL_KEY_GEN_IPV6" | head -5 || echo "  无错误"

# 3. 面板可达性
echo ""
echo "🌐 面板可达性:"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${PANEL_URL}/" 2>/dev/null || echo "000")
echo "  本地: HTTP $HTTP_CODE"

# 4. 节点状态 + Agent 上报 (via OPS API /nodes)
echo ""
echo "🖥️ 节点状态:"
NODES_JSON=$(ops_api "/nodes" 2>/dev/null) || NODES_JSON=""
if [ -n "$NODES_JSON" ]; then
  if command -v jq >/dev/null 2>&1; then
    echo "$NODES_JSON" | jq -r '.nodes[] |
      (if .is_active == 1 then "🟢" else "🔴" end) + " " +
      .name + " (" + .host + ")" +
      (if .remark != "" and .remark != null then " " + .remark else "" end) +
      (if .aws_instance_id != null and .aws_instance_id != "" then " [" + (.aws_type // "ec2") + ":" + .aws_instance_id + "]" else "" end) +
      " 检测:" + (if .last_check != null then .last_check else "从未" end) +
      " Agent:" + (if .agent.online then "🟢" else "🔴" end)
    ' 2>/dev/null | sed 's/^/  /'
  else
    echo "$NODES_JSON" | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        const o=JSON.parse(d);
        for(const n of o.nodes||[]){
          const s=n.is_active?'🟢':'🔴';
          const aws=n.aws_instance_id?' ['+(n.aws_type||'ec2')+':'+n.aws_instance_id+']':'';
          const ag=n.agent&&n.agent.online?'🟢':'🔴';
          console.log('  '+s+' '+n.name+' ('+n.host+') '+(n.remark||'')+aws+' 检测:'+(n.last_check||'从未')+' Agent:'+ag);
        }
      });" 2>/dev/null
  fi
else
  echo "  ❌ OPS API 不可用，跳过"
fi

# 5. 用户统计 (via OPS API /status)
echo ""
echo "👥 用户统计:"
STATUS_JSON=$(ops_api "/status" 2>/dev/null) || STATUS_JSON=""
if [ -n "$STATUS_JSON" ]; then
  if command -v jq >/dev/null 2>&1; then
    echo "$STATUS_JSON" | jq -r '"  总计: \(.users.total) | 正常: \(.users.active) | 封禁: \(.users.blocked) | 冻结: \(.users.frozen) | 在线: \(.users.online)"' 2>/dev/null
  else
    echo "$STATUS_JSON" | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        const o=JSON.parse(d).users;
        console.log('  总计: '+o.total+' | 正常: '+o.active+' | 封禁: '+o.blocked+' | 冻结: '+o.frozen+' | 在线: '+o.online);
      });" 2>/dev/null
  fi
else
  echo "  ❌ OPS API 不可用，跳过"
fi

# 6. 安全事件 (via OPS API /security/multi-node-overview)
echo ""
echo "🛡️ 安全事件 (近24h):"
SEC_JSON=$(ops_api "/security/multi-node-overview?hours=24" 2>/dev/null) || SEC_JSON=""
if [ -n "$SEC_JSON" ]; then
  if command -v jq >/dev/null 2>&1; then
    echo "$SEC_JSON" | jq -r '
      if .total_events == 0 then "  ✅ 无并发多节点观察事件"
      else "  事件: \(.total_events) | 高风险(4+节点): \(.high_count) | 中风险(2-3节点): \(.mid_count) | 涉及用户: \(.user_count) | 最大流量: \((.max_traffic_bytes / 1048576 | floor))MB"
      end' 2>/dev/null
  else
    echo "$SEC_JSON" | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        const o=JSON.parse(d);
        if(!o.total_events)console.log('  ✅ 无并发多节点观察事件');
        else console.log('  事件: '+o.total_events+' | 高风险(4+节点): '+o.high_count+' | 中风险(2-3节点): '+o.mid_count+' | 涉及用户: '+o.user_count+' | 最大流量: '+Math.floor(o.max_traffic_bytes/1048576)+'MB');
      });" 2>/dev/null
  fi
else
  echo "  ❌ OPS API 不可用，跳过"
fi

# 7. 系统资源
echo ""
echo "💻 系统资源:"
echo "  磁盘: $(df -h / | tail -1 | awk '{print $3"/"$2" ("$5")"}')"
echo "  内存: $(free -m | awk 'NR==2{print $3"/"$2"MB ("int($3/$2*100)"%)"}')"
echo "  负载: $(cat /proc/loadavg | awk '{print $1, $2, $3}')"

echo ""
echo "========== 巡检完毕 =========="
