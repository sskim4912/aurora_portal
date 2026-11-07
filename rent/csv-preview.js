const HEADERS = ['순번', '입력번호', '증빙종류', '거래처구분', '거래처', '작성일자', '금액', '리스예외사유', '비용구분', '계정과목', '사용내역', '발생일자', '만기일자', '지불유형'];
const ORDER = ['반영순서', '1', '3', '4', '5', '6', '7', '16', '19', '20', '22', '23', '24', '28'];

function decodeCSV(bytes) {
  let text;
  let encoding;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    encoding = 'UTF-8';
  } catch {
    try {
      // The WHATWG euc-kr decoder includes the CP949 extension.
      text = new TextDecoder('euc-kr', { fatal: true }).decode(bytes);
      encoding = 'CP949 / EUC-KR';
    } catch {
      throw new Error('UTF-8 또는 CP949/EUC-KR 인코딩의 CSV를 선택해 주세요.');
    }
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw new Error('CSV에 지원하지 않는 제어 문자가 있습니다.');
  }
  return { text, encoding };
}

function parseCSV(text) {
  let row = [];
  let cell = '';
  let state = 'start';
  let rowNumber = 0;
  let count = 0;
  let rowTouched = false;
  const preview = [];
  function addCell() {
    row.push(cell);
    cell = '';
    if (row.length > 14) throw new Error(`CSV ${rowNumber + 1}행의 열 수가 14개를 초과합니다.`);
  }
  function addRow() {
    addCell();
    rowNumber++;
    if (row.length !== 14) throw new Error(`CSV ${rowNumber}행은 14개 열이어야 합니다. 현재 ${row.length}개입니다.`);
    if (rowNumber <= 2) {
      const expected = rowNumber === 1 ? ORDER : HEADERS;
      if (row.some((value, i) => value !== expected[i])) {
        throw new Error(rowNumber === 1 ? '첫 줄의 자동입력 반영순서가 지정된 14개 열과 일치하지 않습니다.' : '둘째 줄의 항목명이 지정된 14개 열과 일치하지 않습니다.');
      }
    } else {
      if (row.every((value) => !value.trim())) throw new Error(`CSV ${rowNumber}행에 데이터가 없습니다.`);
      count++;
      preview.push(row);
    }
    row = [];
    rowTouched = false;
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else state = 'closed';
      } else cell += char;
      continue;
    }
    if (char === ',') { addCell(); state = 'start'; rowTouched = true; }
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      addRow(); state = 'start';
    } else if (char === '"' && state === 'start') { state = 'quoted'; rowTouched = true; }
    else {
      if (char === '"' || state === 'closed') throw new Error(`CSV ${rowNumber + 1}행의 큰따옴표 형식이 올바르지 않습니다.`);
      cell += char; state = 'plain'; rowTouched = true;
    }
  }
  if (state === 'quoted') throw new Error('닫히지 않은 큰따옴표가 있습니다. CSV 형식을 확인해 주세요.');
  if (rowTouched || row.length || cell) addRow();
  if (rowNumber < 2) throw new Error('반영순서와 항목명으로 구성된 2줄 헤더가 필요합니다.');
  if (!count) throw new Error('헤더 외에 전표 데이터가 한 건 이상 있어야 합니다.');
  return { count, preview };
}

export function parsePreview(bytes) {
  const { text, encoding } = decodeCSV(bytes);
  const { count, preview } = parseCSV(text);
  return { headers: HEADERS, rows: preview, count, encoding };
}
