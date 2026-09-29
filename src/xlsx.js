import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/* 아주 작은 엑셀(.xlsx) 읽기·쓰기 (fflate 로 압축만 처리, 별도 라이브러리 없음)
   - writeXlsx([{ name, rows: [[셀...]], cols: [너비...] }]) → Uint8Array  (첫 줄은 굵게)
   - readXlsx(Uint8Array) → 첫 시트의 [[셀...]] (문자열 또는 숫자)
   - 날짜 칸이 엑셀 날짜(일련번호)로 저장돼 있으면 숫자로 돌아오므로 excelDate 로 바꾼다 */

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = i => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const colIndex = ref => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/* 셀 스타일 번호: 0 기본, 1 머리글(굵게·테두리·가운데), 2 설명(줄바꿈·테두리·위쪽 정렬), 3 입력 칸(테두리)
   sheet = { name, rows, cols(열 너비), rowStyle(행 번호 → 스타일), heights(행 번호 → 높이), header(머리글 행, 기본 0),
             grid(눈금선, 기본 true), blank(빈 입력 칸 행 수) } */
function sheetXml({ rows, cols, rowStyle = {}, heights = {}, header = 0, grid = true, blank = 0 }) {
  const width = Math.max(...rows.map(r => r.length));
  const all = [...rows, ...Array.from({ length: blank }, () => Array(width).fill(''))];
  const colsXml = cols?.length ? `<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = all.map((r, ri) => {
    const sid = rowStyle[ri] ?? (ri === header ? 1 : grid ? 0 : 3);
    const st = sid ? ` s="${sid}"` : '', ht = heights[ri] ? ` ht="${heights[ri]}" customHeight="1"` : '';
    const cells = Array.from({ length: Math.max(r.length, sid ? width : 0) }, (_, ci) => {
      const v = r[ci], ref = `${colName(ci)}${ri + 1}`;
      if (v === '' || v == null) return sid ? `<c r="${ref}"${st}/>` : '';
      return typeof v === 'number' ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}"${ht}>${cells}</row>`;
  }).join('');
  const top = `A${header + 2}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${grid ? '' : ' showGridLines="0"'}><pane ySplit="${header + 1}" topLeftCell="${top}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${colsXml}<sheetData>${body}</sheetData></worksheet>`;
}

export function writeXlsx(sheets) {
  const ns = 'http://schemas.openxmlformats.org/';
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><color rgb="FF000000"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FF000000"/><name val="맑은 고딕"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s); });
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

export function readXlsx(buf) {
  const z = unzipSync(buf);
  const xml = p => (z[p] ? new DOMParser().parseFromString(strFromU8(z[p]), 'application/xml') : null);
  const text = el => [...el.getElementsByTagName('t')].map(t => t.textContent).join('');
  // 첫 번째 시트 파일 찾기
  let path = 'xl/worksheets/sheet1.xml';
  const wb = xml('xl/workbook.xml'), rels = xml('xl/_rels/workbook.xml.rels');
  const first = wb?.getElementsByTagName('sheet')[0];
  if (first && rels) {
    const id = first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === id);
    if (rel) { const t = rel.getAttribute('Target').replace(/^\//, ''); path = t.startsWith('xl/') ? t : `xl/${t}`; }
  }
  const sheet = xml(path);
  if (!sheet) throw new Error('시트를 찾지 못했습니다');
  const sst = xml('xl/sharedStrings.xml');
  const shared = sst ? [...sst.getElementsByTagName('si')].map(text) : [];
  return [...sheet.getElementsByTagName('row')].map(row => {
    const out = [];
    [...row.getElementsByTagName('c')].forEach((c, k) => {
      const i = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : k, t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      out[i] = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? text(c) : t === 'str' || t === 'e' ? v : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v === '' ? '' : Number(v);
    });
    return Array.from(out, x => (x == null ? '' : x));
  });
}

/** 엑셀 날짜 일련번호 → 'YYYY-MM-DD' */
export function excelDate(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 브라우저에서 파일로 내려받기 */
export function download(data, name, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
