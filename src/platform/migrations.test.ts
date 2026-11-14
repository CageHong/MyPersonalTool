import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { MigrationIntegrityError, runMigrations } from './migrations'
import { checkNewestMigration } from './testing/migrationCheck'

// 虛構的兩個 migration:0001 用 Drizzle Kit 的寫法重建有 cascade 子表的父表
const folders: string[] = []
after(() => folders.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function migrations(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-test-'))
  folders.push(dir)
  mkdirSync(join(dir, 'meta'))
  const tags = Object.keys(files)
  tags.forEach((tag) => writeFileSync(join(dir, `${tag}.sql`), files[tag]))
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: tags.map((tag, idx) => ({ idx, version: '6', when: 1000 + idx, tag, breakpoints: true })),
    }),
  )
  return dir
}

const INIT = `CREATE TABLE parent (id integer PRIMARY KEY, kind text CHECK (kind IN ('a')));
--> statement-breakpoint
CREATE TABLE child (id integer PRIMARY KEY, parent_id integer NOT NULL REFERENCES parent(id) ON DELETE CASCADE);`
const REBUILD = `PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE __new_parent (id integer PRIMARY KEY, kind text CHECK (kind IN ('a','b')));
--> statement-breakpoint
INSERT INTO __new_parent SELECT id, kind FROM parent;--> statement-breakpoint
DROP TABLE parent;--> statement-breakpoint
ALTER TABLE __new_parent RENAME TO parent;--> statement-breakpoint
PRAGMA foreign_keys=ON;`
const BROKEN = `DELETE FROM parent;`

const seed = (sqlite: Database.Database) =>
  sqlite.exec(`INSERT INTO parent VALUES (1, 'a'); INSERT INTO child VALUES (10, 1), (11, 1);`)

test('重建有 cascade 子表的父表:子表的資料保留,外鍵檢查為空', () => {
  const result = checkNewestMigration(migrations({ '0000_init': INIT, '0001_rebuild': REBUILD }), seed)
  assert.equal(result.newest, '0001_rebuild')
  assert.deepEqual(result.before, { child: 2, parent: 1 })
  assert.deepEqual(result.changed, [])
  assert.deepEqual(result.violations, [])
})

test('對照:直接用 Drizzle 的 migrate,同一個 migration 會刪光子表', () => {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: migrations({ '0000_init': INIT }) })
  seed(sqlite)
  migrate(db, { migrationsFolder: migrations({ '0000_init': INIT, '0001_rebuild': REBUILD }) })
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM child').get() as { n: number }).n, 0)
})

test('套用後有外鍵指不到資料時報錯;外鍵設定恢復原狀', () => {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite)
  runMigrations(db, migrations({ '0000_init': INIT }))
  seed(sqlite)
  assert.throws(
    () => runMigrations(db, migrations({ '0000_init': INIT, '0001_broken': BROKEN })),
    MigrationIntegrityError,
  )
  assert.equal(sqlite.pragma('foreign_keys', { simple: true }), 1)
})

test('在 transaction 裡呼叫時拒絕', () => {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  sqlite.exec('BEGIN')
  assert.throws(() => runMigrations(db, migrations({ '0000_init': INIT })), /transaction/)
  sqlite.exec('ROLLBACK')
})

test('只有一個 migration 時沒有東西可以檢查', () => {
  assert.equal(checkNewestMigration(migrations({ '0000_init': INIT }), seed).newest, null)
})
