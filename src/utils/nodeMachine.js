/** Identify a machine by its SSH endpoint, falling back to the address of a manual node. */
function machineKey(node) {
  let host = (node.ssh_host || node.host || '').trim().toLowerCase().replace(/\.$/, '');
  if (host.includes(':') && !host.startsWith('[')) host = '[' + host + ']';
  return host + ':' + (Number(node.ssh_port) || 22);
}

/** Group endpoints for display without changing node IDs or protocol settings. */
function groupNodesByMachine(nodes) {
  const machines = new Map();
  for (const node of nodes) {
    const key = machineKey(node);
    if (!machines.has(key)) machines.set(key, { key, nodes: [] });
    machines.get(key).nodes.push(node);
  }
  return [...machines.values()];
}

module.exports = { machineKey, groupNodesByMachine };
