import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NotFoundError, ValidationError } from '../errors'
import { ACCOUNTS, AT, freshLedger } from '../testing'
import { createBalanceAccount, listBalanceAccounts, updateBalanceAccount } from './balance-accounts'
import { getV2RetiredAt } from './settings'
import { createTransaction, deleteTransaction, forgetDeletedImport, listDeletedImports } from './transactions'

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof ValidationError, String(error))
    return error.fields
  }
  assert.fail('應該要丟 ValidationError')
}

test('帳戶:新增(子類型要對、幣別要存在、同類型名稱不重複)、改名、封存;清單帶餘額', () => {
  const db = freshLedger()
  const id = createBalanceAccount(db, { name: ' Advances ', type: 'asset', subtype: 'receivable', currency: 'EUR' }, '2030-02-01T00:00:00Z')
  assert.equal(getV2RetiredAt(db), '2030-02-01T00:00:00+00:00')
  createTransaction(db, {
    occurredAt: '2030-01-15T09:30:00+00:00', source: 'manual',
    postings: [{ accountId: ACCOUNTS.wiseEur, amount: -700, currency: 'EUR' }, { accountId: id, amount: 700, currency: 'EUR' }],
  }, AT)
  const row = listBalanceAccounts(db).find((a) => a.id === id)
  assert.deepEqual(row, { id, name: 'Advances', type: 'asset', subtype: 'receivable', currency: 'EUR', isActive: true, transactions: 1, balance: 700 })
  updateBalanceAccount(db, id, { name: 'Lent', isActive: false })
  assert.equal(listBalanceAccounts(db).find((a) => a.id === id)?.name, 'Lent')
  assert.deepEqual(fieldsOf(() => createBalanceAccount(db, { name: 'X', type: 'liability', subtype: 'bank', currency: 'EUR' })), { subtype: 'invalid' })
  assert.deepEqual(fieldsOf(() => createBalanceAccount(db, { name: 'X', type: 'asset', subtype: 'bank', currency: 'XYZ' })), { currency: 'not_found' })
  assert.deepEqual(fieldsOf(() => createBalanceAccount(db, { name: 'Lent', type: 'asset', subtype: 'bank', currency: 'EUR' })), { name: 'duplicate' })
  assert.throws(() => updateBalanceAccount(db, ACCOUNTS.food, { name: 'X' }), NotFoundError)
})

test('刪掉過的匯入交易:清單帶快照摘要;取消刪除後從清單拿掉', () => {
  const db = freshLedger()
  const id = createTransaction(db, {
    occurredAt: '2030-01-15T09:30:00+00:00', source: 'wise_csv', externalId: 'X-1',
    postings: [{ accountId: ACCOUNTS.wiseEur, amount: -700, currency: 'EUR' }, { accountId: ACCOUNTS.food, amount: 700, currency: 'EUR' }],
  }, AT)
  deleteTransaction(db, id, AT, '2030-02-01T00:00:00Z')
  assert.deepEqual(listDeletedImports(db), [{
    externalId: 'X-1', source: 'wise_csv', deletedAt: '2030-02-01T00:00:00+00:00',
    occurredAt: '2030-01-15T09:30:00+00:00', payee: null, amounts: [{ currency: 'EUR', amount: 700 }],
  }])
  forgetDeletedImport(db, 'X-1')
  assert.deepEqual(listDeletedImports(db), [])
  assert.deepEqual(fieldsOf(() => forgetDeletedImport(db, 'X-1')), { externalId: 'not_found' })
})
