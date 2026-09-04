// v50: 字节 / Base64url / 十六进制转换
export function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function bytesToB64url(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
