const Database = require('better-sqlite3');
const db = new Database('F:/wz/UE_CICD/UE_Web_Builder/backend/build_history.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', JSON.stringify(tables));
tables.forEach(t => {
  const cols = db.prepare("PRAGMA table_info(" + t.name + ")").all();
  console.log('\n[' + t.name + '] columns:', cols.map(c => c.name).join(', '));
  const rows = db.prepare('SELECT * FROM ' + t.name + ' ORDER BY rowid DESC LIMIT 5').all();
  console.log(JSON.stringify(rows, null, 2));
});
db.close();
