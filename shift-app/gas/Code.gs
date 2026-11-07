/**
 * シフト表アプリ 同期用 Apps Script
 *
 * 使い方:
 *  1. Googleスプレッドシートを新規作成（名前は何でも可。例「シフト表データ」）
 *  2. 拡張機能 → Apps Script を開き、既存の内容を消してこのファイルの中身を貼り付けて保存
 *  3. 下の TOKEN を自分だけが知る文字列に書き換える（半角英数、長め推奨）
 *  4. 右上「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *       - 説明: 任意
 *       - 次のユーザーとして実行: 自分
 *       - アクセスできるユーザー: 全員
 *     →「デプロイ」→ 承認 → 表示された「ウェブアプリのURL」をコピー
 *  5. シフト表アプリの 設定 → クラウド同期 に URL と TOKEN を入力
 *
 *  ※ コードを変更したら「デプロイ」→「デプロイを管理」→ 編集(鉛筆) → バージョン「新バージョン」→ デプロイ
 *     で更新しないと反映されません。
 */

const TOKEN = 'CHANGE-ME-to-a-long-random-string';
const SHEET_NAME = 'data';

function doGet(e) {
  return handle_(e, 'GET');
}
function doPost(e) {
  return handle_(e, 'POST');
}

function handle_(e, method) {
  try {
    const p = (e && e.parameter) || {};
    let body = null;
    if (method === 'POST' && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (err) { body = null; }
    }
    const token = p.token || (body && body.token);
    if (token !== TOKEN) return out_({ ok: false, error: 'unauthorized' });

    const action = p.action || (body && body.action) || 'get';
    const sheet = getSheet_();

    if (action === 'get') {
      const rec = read_(sheet);
      return out_({ ok: true, updatedAt: rec.updatedAt, data: rec.data });
    }
    if (action === 'put') {
      if (!body || !body.data) return out_({ ok: false, error: 'no data' });
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const cur = read_(sheet);
        // 古い端末からの上書き防止: クライアントが知っている更新時刻と違えば衝突扱い
        if (body.baseUpdatedAt && cur.updatedAt && body.baseUpdatedAt !== cur.updatedAt && !body.force) {
          return out_({ ok: false, error: 'conflict', updatedAt: cur.updatedAt, data: cur.data });
        }
        const now = new Date().toISOString();
        write_(sheet, now, body.data);
        return out_({ ok: true, updatedAt: now });
      } finally {
        lock.releaseLock();
      }
    }
    if (action === 'ping') return out_({ ok: true, time: new Date().toISOString() });
    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange('A1').setValue('updatedAt');
    sh.getRange('B1').setValue('json(分割保存)');
  }
  return sh;
}

// セルの文字数上限(5万)を避けるため、JSONを 40,000 文字ずつ B2, B3, ... に分割保存
function read_(sh) {
  const updatedAt = String(sh.getRange('A2').getValue() || '');
  const last = sh.getLastRow();
  if (last < 2) return { updatedAt: '', data: null };
  const vals = sh.getRange(2, 2, last - 1, 1).getValues().map(r => String(r[0] || ''));
  const json = vals.join('');
  if (!json) return { updatedAt: updatedAt, data: null };
  try { return { updatedAt: updatedAt, data: JSON.parse(json) }; }
  catch (e) { return { updatedAt: updatedAt, data: null }; }
}

function write_(sh, updatedAt, data) {
  const json = JSON.stringify(data);
  const CH = 40000;
  const chunks = [];
  for (let i = 0; i < json.length; i += CH) chunks.push([json.slice(i, i + CH)]);
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 2).clearContent();
  sh.getRange('A2').setValue(updatedAt);
  sh.getRange(2, 2, chunks.length, 1).setValues(chunks);
  // 履歴（直近30件）を history シートに残す: 誤操作からの復旧用
  const ss = sh.getParent();
  let hist = ss.getSheetByName('history');
  if (!hist) { hist = ss.insertSheet('history'); hist.appendRow(['updatedAt', 'bytes', 'json(先頭のみ)']); }
  hist.insertRowAfter(1);
  hist.getRange(2, 1, 1, 3).setValues([[updatedAt, json.length, json.slice(0, 45000)]]);
  const hl = hist.getLastRow();
  if (hl > 31) hist.deleteRows(32, hl - 31);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
