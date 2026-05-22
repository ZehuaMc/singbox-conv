import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLinks, parseShareLink, parseSubscriptionText } from '../src/parse.js';

test('extracts links from base64 subscription', () => {
  const body = Buffer.from('ss://YWVzLTI1Ni1nY206cGFzc0BleGFtcGxlLmNvbTo4Mzg4#香港01').toString('base64');
  assert.deepEqual(extractLinks(body), ['ss://YWVzLTI1Ni1nY206cGFzc0BleGFtcGxlLmNvbTo4Mzg4#香港01']);
});

test('parses shadowsocks SIP002 link', () => {
  const outbound = parseShareLink('ss://YWVzLTI1Ni1nY206cGFzcw@example.com:8388#香港01');
  assert.equal(outbound.type, 'shadowsocks');
  assert.equal(outbound.tag, '香港01');
  assert.equal(outbound.server, 'example.com');
  assert.equal(outbound.server_port, 8388);
  assert.equal(outbound.method, 'aes-256-gcm');
  assert.equal(outbound.password, 'pass');
});

test('parses vmess json link', () => {
  const encoded = Buffer.from(JSON.stringify({
    ps: '日本01',
    add: 'jp.example.com',
    port: '443',
    id: '00000000-0000-0000-0000-000000000000',
    aid: '0',
    net: 'ws',
    path: '/ws',
    host: 'host.example.com',
    tls: 'tls',
    sni: 'sni.example.com',
    fp: 'chrome',
  })).toString('base64');
  const outbound = parseShareLink(`vmess://${encoded}`);
  assert.equal(outbound.type, 'vmess');
  assert.equal(outbound.tag, '日本01');
  assert.equal(outbound.transport.type, 'ws');
  assert.equal(outbound.tls.server_name, 'sni.example.com');
  assert.deepEqual(outbound.tls.utls, { enabled: true, fingerprint: 'chrome' });
});

test('parses vless reality grpc extras', () => {
  const outbound = parseShareLink('vless://00000000-0000-0000-0000-000000000000@example.com:443?type=grpc&security=reality&flow=&pbk=public-key&sid=short-id&sni=sni.example.com&serviceName=update&fp=chrome#美国VLESS');
  assert.equal(outbound.type, 'vless');
  assert.equal(outbound.tag, '美国VLESS');
  assert.equal(outbound.packet_encoding, 'packetaddr');
  assert.equal(outbound.flow, '');
  assert.equal(outbound.tls.server_name, 'sni.example.com');
  assert.deepEqual(outbound.tls.reality, {
    enabled: true,
    public_key: 'public-key',
    short_id: 'short-id',
  });
  assert.deepEqual(outbound.tls.utls, { enabled: true, fingerprint: 'chrome' });
  assert.deepEqual(outbound.transport, { type: 'grpc', service_name: 'update' });
});

test('parses tuic link', () => {
  const outbound = parseShareLink('tuic://00000000-0000-0000-0000-000000000000:secret@example.com:443?congestion_control=bbr&udp_relay_mode=native&alpn=h3&sni=tuic.example.com#美国TUIC');
  assert.equal(outbound.type, 'tuic');
  assert.equal(outbound.tag, '美国TUIC');
  assert.equal(outbound.uuid, '00000000-0000-0000-0000-000000000000');
  assert.equal(outbound.password, 'secret');
  assert.equal(outbound.congestion_control, 'bbr');
  assert.equal(outbound.udp_relay_mode, 'native');
  assert.equal(outbound.zero_rtt_handshake, false);
  assert.equal(outbound.tls.server_name, 'tuic.example.com');
  assert.deepEqual(outbound.tls.alpn, ['h3']);
});

test('extracts usable proxy outbounds from sing-box JSON subscription', () => {
  const result = parseSubscriptionText(JSON.stringify({
    outbounds: [
      { type: 'selector', tag: '节点选择', outbounds: ['香港01'] },
      { type: 'direct', tag: 'direct' },
      {
        type: 'anytls',
        tag: '剩余流量：99.42 GB',
        server: 'info.example.com',
        server_port: 443,
        password: 'info',
      },
      {
        type: 'anytls',
        tag: '香港01|标准',
        server: 'hk.example.com',
        server_port: 443,
        password: 'secret',
        tls: { enabled: true, server_name: 'hk.example.com' },
      },
      {
        type: 'shadowsocks',
        tag: '日本02|标准|V6',
        server: 'jp.example.com',
        server_port: 8388,
        method: 'aes-128-gcm',
        password: 'secret',
      },
    ],
  }), 'json-source');

  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.outbounds.map((outbound) => outbound.tag), ['香港01|标准', '日本02|标准|V6']);
  assert.equal(result.outbounds[0].type, 'anytls');
  assert.equal(result.outbounds[1].type, 'shadowsocks');
});

test('extracts usable proxy outbounds from base64 sing-box JSON subscription', () => {
  const body = Buffer.from(JSON.stringify({
    outbounds: [
      {
        type: 'vless',
        tag: '美国01',
        server: 'us.example.com',
        server_port: 443,
        uuid: '00000000-0000-0000-0000-000000000000',
      },
    ],
  })).toString('base64');

  const result = parseSubscriptionText(body, 'base64-json-source');
  assert.equal(result.warnings.length, 0);
  assert.equal(result.outbounds.length, 1);
  assert.equal(result.outbounds[0].tag, '美国01');
});

test('skips invalid links with warnings', () => {
  const result = parseSubscriptionText('ss://bad', 'bad-source');
  assert.equal(result.outbounds.length, 0);
  assert.equal(result.warnings.length, 1);
});
