export const CHUNK_SIZE = 256 * 1024;
export const IMAGE_LIMIT = 20 * 1024 * 1024;
export const VIDEO_LIMIT = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export const MAX_TICKET_BYTES = 200 * 1024 * 1024;
export const MEDIA_TYPES = ['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif','video/mp4','video/webm','video/quicktime'];
export function fileLimit(type) { return type.startsWith('video/') ? VIDEO_LIMIT : IMAGE_LIMIT; }
export function inferType(file) {
  if (MEDIA_TYPES.includes(file.type)) return file.type;
  const extension = file.name.split('.').pop().toLowerCase();
  return ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif',heic:'image/heic',heif:'image/heif',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'})[extension] || '';
}
export function matchesSignature(bytes, type) {
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if(type==='image/png') return bytes[0]===137 && ascii(1,4)==='PNG' && bytes[4]===13 && bytes[5]===10;
  if(type==='image/jpeg') return bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  if(type==='image/gif') return ['GIF87a','GIF89a'].includes(ascii(0,6));
  if(type==='image/webp') return ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP';
  if(type==='video/webm') return bytes[0]===26 && bytes[1]===69 && bytes[2]===223 && bytes[3]===163;
  if(['image/avif','image/heic','image/heif','video/mp4','video/quicktime'].includes(type)) {
    if(ascii(4,8)!=='ftyp') return type==='video/quicktime' && ['moov','mdat','wide'].includes(ascii(4,8));
    const brands=ascii(8,40);
    if(type==='image/avif') return /avif|avis/.test(brands);
    if(type==='image/heic'||type==='image/heif') return /heic|heix|hevc|hevx|mif1|msf1/.test(brands);
    return !/avif|avis|heic|heix/.test(brands);
  }
  return false;
}

export function decodeBase64(value) {
  if(typeof Uint8Array.fromBase64==='function')return Uint8Array.fromBase64(value);
  const binary=atob(value),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
