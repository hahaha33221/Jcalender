/* 옛 엑셀(.xls, BIFF8) 첫 시트 읽기 — 라이브러리 없이 (카드사 이용내역 파일용)
   구조: CFB(복합 문서) 안의 "Workbook" 스트림 → BIFF 레코드
   읽는 셀: 공유 문자열(LABELSST), 문자열(LABEL), 숫자(NUMBER·RK·MULRK), 수식 결과(FORMULA·STRING), 참/거짓(BOOLERR)
   readXls(Uint8Array) → [[셀...]] (문자열 또는 숫자, 날짜는 엑셀 일련번호 숫자) */

const END = 0xfffffffe, FREE = 0xffffffff;

function cfbStream(buf, names) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!sig.every((b, i) => buf[i] === b)) throw new Error('엑셀(.xls) 파일이 아닙니다');
  const ssz = 1 << dv.getUint16(0x1e, true), mssz = 1 << dv.getUint16(0x20, true);
  const nFat = dv.getUint32(0x2c, true), dirStart = dv.getUint32(0x30, true), cutoff = dv.getUint32(0x38, true);
  const miniFatStart = dv.getUint32(0x3c, true);
  let difatSec = dv.getUint32(0x44, true);
  const sec = id => (id + 1) * ssz;
  // FAT 섹터 목록 (헤더 109개 + DIFAT 체인)
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(0x4c + i * 4, true));
  while (fatSecs.length < nFat && difatSec !== END && difatSec !== FREE) {
    const o = sec(difatSec), per = ssz / 4 - 1;
    for (let i = 0; i < per && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(o + i * 4, true));
    difatSec = dv.getUint32(o + per * 4, true);
  }
  const fat = [];
  fatSecs.forEach(s => { const o = sec(s); for (let i = 0; i < ssz / 4; i++) fat.push(dv.getUint32(o + i * 4, true)); });
  const chain = (start, table) => { const out = []; for (let s = start, n = 0; s !== END && s !== FREE && s < table.length && n < 1e6; s = table[s], n++) out.push(s); return out; };
  const readChain = start => { const ids = chain(start, fat), out = new Uint8Array(ids.length * ssz); ids.forEach((s, i) => out.set(buf.subarray(sec(s), sec(s) + ssz), i * ssz)); return out; };
  // 디렉터리
  const dir = readChain(dirStart), ddv = new DataView(dir.buffer);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = ddv.getUint16(o + 0x40, true);
    let name = '';
    for (let i = 0; i < Math.max(0, nl / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    entries.push({ name, type: dir[o + 0x42], start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
  }
  const e = entries.find(x => x.type === 2 && names.includes(x.name));
  if (!e) throw new Error('엑셀 통합 문서를 찾지 못했습니다');
  if (e.size >= cutoff) return readChain(e.start).subarray(0, e.size);
  // 작은 스트림은 미니 스트림에 있다
  const root = entries.find(x => x.type === 5), ministream = readChain(root.start);
  const mf = readChain(miniFatStart), mdv = new DataView(mf.buffer), miniFat = [];
  for (let i = 0; i < mf.length / 4; i++) miniFat.push(mdv.getUint32(i * 4, true));
  const ids = chain(e.start, miniFat), out = new Uint8Array(ids.length * mssz);
  ids.forEach((s, i) => out.set(ministream.subarray(s * mssz, (s + 1) * mssz), i * mssz));
  return out.subarray(0, e.size);
}

const rk = v => {
  let n;
  if (v & 2) n = v >> 2;
  else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(0, v & 0xfffffffc, false); b.setUint32(4, 0, false); n = b.getFloat64(0, false); }
  return v & 1 ? n / 100 : n;
};

/** SST: 여러 조각(SST + CONTINUE)에 걸친 문자열 읽기 */
function readSst(segs) {
  let si = 0, pos = 8;                                   // 첫 조각: 전체 개수(4) · 고유 개수(4)
  const cur = () => segs[si];
  const next = () => { si++; pos = 0; };
  const u8 = () => { if (pos >= cur().length) next(); return cur()[pos++]; };
  const u16 = () => u8() | (u8() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const skip = n => { while (n > 0) { if (pos >= cur().length) next(); const k = Math.min(n, cur().length - pos); pos += k; n -= k; } };
  const count = new DataView(segs[0].buffer, segs[0].byteOffset).getUint32(4, true);
  const out = [];
  for (let i = 0; i < count && si < segs.length; i++) {
    if (pos >= cur().length) { next(); if (si >= segs.length) break; }
    const cch = u16(); let fl = u8();
    const runs = fl & 8 ? u16() : 0, ext = fl & 4 ? u32() : 0;
    let s = '', left = cch;
    while (left > 0) {
      if (pos >= cur().length) { next(); fl = u8(); }     // 조각이 바뀌면 글자 폭 표시가 새로 온다
      const wide = fl & 1, seg = cur();
      const can = Math.min(left, Math.floor((seg.length - pos) / (wide ? 2 : 1)));
      for (let k = 0; k < can; k++) { s += String.fromCharCode(wide ? seg[pos] | (seg[pos + 1] << 8) : seg[pos]); pos += wide ? 2 : 1; }
      left -= can;
      if (can === 0) { pos = seg.length; }
    }
    skip(runs * 4 + ext);
    out.push(s);
  }
  return out;
}

export function readXls(buf) {
  const wb = cfbStream(buf, ['Workbook', 'Book']);
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  const rows = [];
  const put = (r, c, v) => { (rows[r] ||= [])[c] = v; };
  let sst = [], sstSegs = null, bof = 0, pendingStr = null;
  const str = (o, len) => {                              // XLUnicodeString (LABEL)
    const cch = dv.getUint16(o, true), fl = wb[o + 2]; let s = '';
    for (let i = 0, p = o + 3; i < cch && p < o + len; i++) { s += String.fromCharCode(fl & 1 ? dv.getUint16(p, true) : wb[p]); p += fl & 1 ? 2 : 1; }
    return s;
  };
  for (let o = 0; o + 4 <= wb.length;) {
    const type = dv.getUint16(o, true), len = dv.getUint16(o + 2, true), d = o + 4;
    o = d + len;
    if (sstSegs && type !== 0x003c) { sst = readSst(sstSegs); sstSegs = null; }
    if (type === 0x0809) { bof++; continue; }
    if (type === 0x000a && bof >= 2) break;             // 첫 시트 끝
    if (type === 0x00fc) { sstSegs = [wb.subarray(d, d + len)]; continue; }
    if (type === 0x003c && sstSegs) { sstSegs.push(wb.subarray(d, d + len)); continue; }
    if (bof < 2) continue;
    const r = dv.getUint16(d, true), c = dv.getUint16(d + 2, true);
    if (type === 0x00fd) put(r, c, sst[dv.getUint32(d + 6, true)] ?? '');
    else if (type === 0x0203) put(r, c, dv.getFloat64(d + 6, true));
    else if (type === 0x027e) put(r, c, rk(dv.getUint32(d + 6, true)));
    else if (type === 0x00bd) { const last = dv.getUint16(d + len - 2, true); for (let k = c, p = d + 4; k <= last; k++, p += 6) put(r, k, rk(dv.getUint32(p + 2, true))); }
    else if (type === 0x0204) put(r, c, str(d + 6, len - 6));
    else if (type === 0x0205) put(r, c, wb[d + 7] ? '' : wb[d + 6] ? 'TRUE' : 'FALSE');
    else if (type === 0x0006) {
      if (dv.getUint16(d + 12, true) === 0xffff) { if (wb[d + 6] === 0) pendingStr = [r, c]; }
      else put(r, c, dv.getFloat64(d + 6, true));
    } else if (type === 0x0207 && pendingStr) { put(pendingStr[0], pendingStr[1], str(d, len)); pendingStr = null; }
  }
  return Array.from(rows, r => Array.from(r || [], x => (x == null ? '' : x)));
}
