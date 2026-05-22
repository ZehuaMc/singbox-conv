import { URL } from 'node:url';

const SUPPORTED_PROTOCOLS = new Set(['ss', 'vmess', 'trojan', 'vless', 'hysteria2', 'hy2', 'tuic']);
const NON_PROXY_OUTBOUND_TYPES = new Set(['block', 'direct', 'dns', 'selector', 'urltest']);
const SUBSCRIPTION_INFO_PATTERN = /^(剩余流量|距离下次重置剩余|套餐到期|到期时间|过期时间|expire|traffic|remaining|reset)\s*[:：]/i;

export function parseSubscriptionText(text, sourceName = 'subscription') {
  const singBoxResult = parseSingBoxSubscription(text, sourceName);
  if (singBoxResult) {
    return singBoxResult;
  }

  const warnings = [];
  const links = extractLinks(text);
  const outbounds = [];

  for (const link of links) {
    try {
      const outbound = parseShareLink(link);
      if (outbound) {
        outbounds.push(outbound);
      }
    } catch (error) {
      warnings.push(`${sourceName}: skipped ${shorten(link)} (${error.message})`);
    }
  }

  if (links.length === 0 && text.trim()) {
    warnings.push(`${sourceName}: no supported share links found`);
  }

  return { outbounds, warnings };
}

function parseSingBoxSubscription(text, sourceName) {
  const config = parseJsonLikeSubscription(text);
  if (!config) {
    return null;
  }

  const sourceOutbounds = Array.isArray(config) ? config : config.outbounds;
  if (!Array.isArray(sourceOutbounds)) {
    return {
      outbounds: [],
      warnings: [`${sourceName}: JSON subscription has no outbounds array`],
    };
  }

  const outbounds = [];
  const warnings = [];
  for (const outbound of sourceOutbounds) {
    if (!isUsableSingBoxOutbound(outbound)) {
      continue;
    }

    const next = structuredClone(outbound);
    removeUndefined(next);
    outbounds.push(next);
  }

  if (outbounds.length === 0 && sourceOutbounds.length > 0) {
    warnings.push(`${sourceName}: JSON subscription has no usable proxy outbounds`);
  }

  return { outbounds, warnings };
}

function parseJsonLikeSubscription(text) {
  for (const candidate of jsonCandidates(text)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next representation.
    }
  }
  return null;
}

function jsonCandidates(text) {
  const trimmed = text.trim();
  const candidates = [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    candidates.push(trimmed);
  }

  const decoded = decodeMaybeBase64(text);
  if (decoded) {
    const decodedTrimmed = decoded.trim();
    if (decodedTrimmed.startsWith('{') || decodedTrimmed.startsWith('[')) {
      candidates.push(decodedTrimmed);
    }
  }
  return candidates;
}

function isUsableSingBoxOutbound(outbound) {
  if (!outbound || typeof outbound !== 'object') {
    return false;
  }
  if (!outbound.type || NON_PROXY_OUTBOUND_TYPES.has(outbound.type)) {
    return false;
  }
  if (SUBSCRIPTION_INFO_PATTERN.test(outbound.tag || '')) {
    return false;
  }
  if (!outbound.server || !outbound.server_port) {
    return false;
  }
  return true;
}

export function extractLinks(text) {
  const candidates = new Set();
  collectLinks(text, candidates);

  const decoded = decodeMaybeBase64(text);
  if (decoded && decoded !== text) {
    collectLinks(decoded, candidates);
  }

  return [...candidates];
}

export function parseShareLink(rawLink) {
  const link = rawLink.trim();
  const protocol = getProtocol(link);
  if (!SUPPORTED_PROTOCOLS.has(protocol)) {
    throw new Error(`unsupported protocol ${protocol || 'unknown'}`);
  }

  if (protocol === 'ss') {
    return parseShadowsocks(link);
  }
  if (protocol === 'vmess') {
    return parseVmess(link);
  }
  if (protocol === 'trojan') {
    return parseTrojan(link);
  }
  if (protocol === 'vless') {
    return parseVless(link);
  }
  if (protocol === 'hysteria2' || protocol === 'hy2') {
    return parseHysteria2(link);
  }
  if (protocol === 'tuic') {
    return parseTuic(link);
  }

  throw new Error(`unsupported protocol ${protocol}`);
}

function collectLinks(text, candidates) {
  const normalized = text.replace(/\r/g, '\n').split(/\s+/);
  for (const part of normalized) {
    const clean = part.trim().replace(/^["']|["',;]+$/g, '');
    if (!clean) {
      continue;
    }
    const protocol = getProtocol(clean);
    if (SUPPORTED_PROTOCOLS.has(protocol)) {
      candidates.add(clean);
    }
  }
}

function getProtocol(value) {
  const match = /^([a-z0-9+.-]+):\/\//i.exec(value);
  return match ? match[1].toLowerCase() : '';
}

function decodeMaybeBase64(text) {
  const compact = text.trim().replace(/\s+/g, '');
  if (!compact || compact.includes('://')) {
    return null;
  }
  if (!/^[A-Za-z0-9+/_=-]+$/.test(compact)) {
    return null;
  }
  try {
    const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, '=');
    const decoded = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const decodedTrimmed = decoded.trim();
    return decoded.includes('://') || decodedTrimmed.startsWith('{') || decodedTrimmed.startsWith('[') ? decoded : null;
  } catch {
    return null;
  }
}

function parseShadowsocks(link) {
  const fragment = decodeFragment(link);
  const withoutScheme = link.slice('ss://'.length);
  const hashIndex = withoutScheme.indexOf('#');
  const noHash = hashIndex >= 0 ? withoutScheme.slice(0, hashIndex) : withoutScheme;
  const queryStart = noHash.indexOf('?');
  const main = queryStart >= 0 ? noHash.slice(0, queryStart) : noHash;
  const query = queryStart >= 0 ? new URLSearchParams(noHash.slice(queryStart + 1)) : new URLSearchParams();

  let method;
  let password;
  let hostPort;

  if (main.includes('@')) {
    const [userinfoRaw, hostPortRaw] = splitAtLast(main, '@');
    hostPort = hostPortRaw;
    const userinfo = userinfoRaw.includes(':') ? percentDecode(userinfoRaw) : decodeBase64Url(userinfoRaw);
    [method, password] = splitOnce(userinfo, ':');
  } else {
    const decoded = decodeBase64Url(main);
    const [userinfo, hostPortRaw] = splitAtLast(decoded, '@');
    hostPort = hostPortRaw;
    [method, password] = splitOnce(userinfo, ':');
  }

  const { server, port } = parseHostPort(hostPort);
  assertRequired({ method, password, server, port });

  const outbound = {
    type: 'shadowsocks',
    tag: fragment || `${server}:${port}`,
    server,
    server_port: port,
    method,
    password,
  };

  addPluginTransport(outbound, query);
  return outbound;
}

function parseVmess(link) {
  const encoded = link.slice('vmess://'.length).trim();
  const json = JSON.parse(decodeBase64Url(encoded));
  const server = json.add || json.server;
  const port = toPort(json.port);
  const uuid = json.id || json.uuid;
  assertRequired({ server, port, uuid });

  const outbound = {
    type: 'vmess',
    tag: json.ps || json.name || `${server}:${port}`,
    server,
    server_port: port,
    uuid,
    alter_id: Number(json.aid || json.alterId || 0),
    security: json.scy || json.security || 'auto',
  };

  if (json.net === 'ws') {
    outbound.transport = {
      type: 'ws',
      path: json.path || '/',
    };
    if (json.host) {
      outbound.transport.headers = { Host: json.host };
    }
  } else if (json.net === 'grpc') {
    outbound.transport = {
      type: 'grpc',
      service_name: json.path || json.serviceName || '',
    };
  } else if (json.net === 'http' || json.net === 'h2') {
    outbound.transport = {
      type: 'http',
      path: json.path || '/',
    };
    if (json.host) {
      outbound.transport.host = splitCsv(json.host);
    }
  }

  if (json.tls === 'tls' || json.tls === '1' || json.tls === true) {
    outbound.tls = buildTls({
      serverName: json.sni || json.host,
      insecure: json.allowInsecure,
      alpn: json.alpn,
      fingerprint: json.fp || json.fingerprint,
    });
  }

  return outbound;
}

function parseTrojan(link) {
  const url = new URL(link);
  const server = url.hostname;
  const port = toPort(url.port || '443');
  const password = percentDecode(url.username);
  assertRequired({ server, port, password });

  const outbound = {
    type: 'trojan',
    tag: decodeURIComponent(url.hash.slice(1)) || `${server}:${port}`,
    server,
    server_port: port,
    password,
  };

  outbound.tls = buildTls({
    serverName: url.searchParams.get('sni') || url.searchParams.get('peer') || server,
    insecure: url.searchParams.get('allowInsecure') || url.searchParams.get('skip-cert-verify'),
    alpn: url.searchParams.get('alpn'),
    fingerprint: url.searchParams.get('fp') || url.searchParams.get('fingerprint'),
  });
  addTransport(outbound, url.searchParams);
  return outbound;
}

function parseVless(link) {
  const url = new URL(link);
  const server = url.hostname;
  const port = toPort(url.port || '443');
  const uuid = percentDecode(url.username);
  assertRequired({ server, port, uuid });
  const security = url.searchParams.get('security');

  const outbound = {
    type: 'vless',
    tag: decodeURIComponent(url.hash.slice(1)) || `${server}:${port}`,
    server,
    server_port: port,
    uuid,
    packet_encoding: getVlessPacketEncoding(url.searchParams, security),
    flow: getFirstParam(url.searchParams, ['flow']),
  };
  removeUndefined(outbound);

  if (security === 'tls' || security === 'reality') {
    outbound.tls = buildTls({
      serverName: url.searchParams.get('sni') || url.searchParams.get('peer') || server,
      insecure: url.searchParams.get('allowInsecure') || url.searchParams.get('skip-cert-verify'),
      alpn: url.searchParams.get('alpn'),
      fingerprint: url.searchParams.get('fp') || url.searchParams.get('fingerprint'),
    });
    if (security === 'reality') {
      outbound.tls.reality = {
        enabled: true,
        public_key: url.searchParams.get('pbk') || '',
        short_id: url.searchParams.get('sid') || '',
      };
      if (!outbound.tls.reality.public_key) {
        delete outbound.tls.reality.public_key;
      }
      if (!outbound.tls.reality.short_id) {
        delete outbound.tls.reality.short_id;
      }
    }
  }

  addTransport(outbound, url.searchParams);
  return outbound;
}

function parseHysteria2(link) {
  const normalized = link.replace(/^hy2:\/\//i, 'hysteria2://');
  const url = new URL(normalized);
  const server = url.hostname;
  const port = toPort(url.port || '443');
  const password = percentDecode(url.username);
  assertRequired({ server, port, password });

  const outbound = {
    type: 'hysteria2',
    tag: decodeURIComponent(url.hash.slice(1)) || `${server}:${port}`,
    server,
    server_port: port,
    password,
  };

  const obfs = url.searchParams.get('obfs');
  const obfsPassword = url.searchParams.get('obfs-password') || url.searchParams.get('obfs_password');
  if (obfs && obfsPassword) {
    outbound.obfs = { type: obfs, password: obfsPassword };
  }

  outbound.tls = buildTls({
    serverName: url.searchParams.get('sni') || server,
    insecure: url.searchParams.get('insecure') || url.searchParams.get('allowInsecure'),
    alpn: url.searchParams.get('alpn'),
  });
  return outbound;
}

function parseTuic(link) {
  const url = new URL(link);
  const server = url.hostname;
  const port = toPort(url.port || '443');
  const uuid = percentDecode(url.username);
  const password = percentDecode(url.password);
  assertRequired({ server, port, uuid, password });

  const outbound = {
    type: 'tuic',
    tag: decodeURIComponent(url.hash.slice(1)) || `${server}:${port}`,
    server,
    server_port: port,
    uuid,
    password,
    congestion_control: url.searchParams.get('congestion_control') || url.searchParams.get('congestion-control') || undefined,
    udp_relay_mode: url.searchParams.get('udp_relay_mode') || url.searchParams.get('udp-relay-mode') || undefined,
    zero_rtt_handshake: parseBooleanParam(url.searchParams, [
      'zero_rtt_handshake',
      'zero-rtt-handshake',
      'zero_rtt',
      'zero-rtt',
      'zeroRTTHandshake',
    ]) ?? false,
  };
  removeUndefined(outbound);

  outbound.tls = buildTls({
    serverName: url.searchParams.get('sni') || server,
    insecure: url.searchParams.get('allowInsecure') || url.searchParams.get('insecure'),
    alpn: url.searchParams.get('alpn'),
  });
  return outbound;
}

function addTransport(outbound, params) {
  const type = params.get('type') || params.get('net');
  if (type === 'ws') {
    outbound.transport = {
      type: 'ws',
      path: params.get('path') || '/',
    };
    const host = params.get('host');
    if (host) {
      outbound.transport.headers = { Host: host };
    }
  } else if (type === 'grpc') {
    outbound.transport = {
      type: 'grpc',
      service_name: params.get('serviceName') || params.get('service_name') || '',
    };
  } else if (type === 'http' || type === 'h2') {
    outbound.transport = {
      type: 'http',
      path: params.get('path') || '/',
    };
    const host = params.get('host');
    if (host) {
      outbound.transport.host = splitCsv(host);
    }
  }
}

function addPluginTransport(outbound, params) {
  const plugin = params.get('plugin');
  if (!plugin) {
    return;
  }
  const decoded = percentDecode(plugin);
  if (!decoded.startsWith('v2ray-plugin')) {
    return;
  }
  const opts = new URLSearchParams(decoded.split(';').slice(1).join('&').replace(/;/g, '&'));
  if (opts.get('mode') === 'websocket' || opts.get('mode') === 'ws') {
    outbound.transport = {
      type: 'ws',
      path: opts.get('path') || '/',
    };
    if (opts.get('host')) {
      outbound.transport.headers = { Host: opts.get('host') };
    }
    if (opts.has('tls')) {
      outbound.tls = buildTls({ serverName: opts.get('host') || outbound.server });
    }
  }
}

function getVlessPacketEncoding(params, security) {
  const explicit = getFirstParam(params, [
    'packet_encoding',
    'packet-encoding',
    'packetEncoding',
  ]);
  if (explicit) {
    return explicit;
  }

  const transport = params.get('type') || params.get('net');
  if (security === 'reality' && transport === 'grpc') {
    return 'packetaddr';
  }
  return undefined;
}

function getFirstParam(params, names) {
  for (const name of names) {
    if (params.has(name)) {
      return params.get(name);
    }
  }
  return undefined;
}

function parseBooleanParam(params, names) {
  const value = getFirstParam(params, names);
  return value === undefined ? undefined : isTruthy(value);
}

function buildTls({ serverName, insecure, alpn, fingerprint } = {}) {
  const tls = {
    enabled: true,
  };
  if (serverName) {
    tls.server_name = serverName;
  }
  if (isTruthy(insecure)) {
    tls.insecure = true;
  }
  if (alpn) {
    tls.alpn = splitCsv(alpn);
  }
  if (fingerprint) {
    tls.utls = {
      enabled: true,
      fingerprint,
    };
  }
  return tls;
}

function parseHostPort(value) {
  if (!value) {
    return { server: '', port: 0 };
  }
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    const server = value.slice(1, end);
    const port = toPort(value.slice(end + 2));
    return { server, port };
  }
  const [server, portRaw] = splitAtLast(value, ':');
  return { server, port: toPort(portRaw) };
}

function toPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid port ${value}`);
  }
  return port;
}

function assertRequired(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') {
      throw new Error(`missing ${key}`);
    }
  }
}

function decodeFragment(link) {
  const index = link.indexOf('#');
  return index >= 0 ? decodeURIComponent(link.slice(index + 1)) : '';
}

function decodeBase64Url(value) {
  const compact = value.trim().replace(/\s+/g, '');
  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, '=');
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function percentDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitOnce(value, separator) {
  const index = value.indexOf(separator);
  if (index < 0) {
    return [value, ''];
  }
  return [value.slice(0, index), value.slice(index + separator.length)];
}

function splitAtLast(value, separator) {
  const index = value.lastIndexOf(separator);
  if (index < 0) {
    return [value, ''];
  }
  return [value.slice(0, index), value.slice(index + separator.length)];
}

function splitCsv(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function removeUndefined(value) {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
}

function isTruthy(value) {
  return value === true || value === '1' || value === 'true';
}

function shorten(value) {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}
