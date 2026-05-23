const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const testDbPath = path.join(__dirname, 'tmp-investments.db')
process.env.STONKER_DB_PATH = testDbPath

try {
    fs.unlinkSync(testDbPath)
} catch (err) {
    if (err.code !== 'ENOENT') throw err
}

const db = require('../src/db')

assert.equal(db.getStocks().length, 0)

const added = db.addStock('AAPL')
assert.equal(added.stockTicker, 'AAPL')
assert.equal(added.stockPrice, null)
assert.equal(db.addStock('AAPL'), undefined)
assert.equal(db.getStocks().length, 1)
assert.match(db.formatRow(added), /Price: \$\?\?/)

assert.equal(db.updateStock('UNKNOWN', 10), undefined)
assert.equal(db.updateStock('AAPL', 100), undefined)
assert.equal(db.getStock('AAPL').stockPrice, 100)
assert.equal(db.getStock('AAPL').value, null)

const invested = db.invest('AAPL', 100, 10, 20)
assert.equal(invested.initialValue, 100)
assert.equal(invested.value, 100)
assert.equal(invested.minValue, 90)
assert.equal(invested.maxValue, 120)
assert.match(db.formatRow(invested), /Invested: \$100\.00 \| Now: \$100\.00/)

assert.equal(db.updateStock('AAPL', 105), undefined)
assert.equal(db.getStock('AAPL').value, 105)

const crossedOut = db.updateStock('AAPL', 130)
assert.equal(crossedOut.stockTicker, 'AAPL')
assert.equal(crossedOut.value, 130)

assert.equal(db.updateStock('AAPL', 125), undefined)

const crossedIn = db.updateStock('AAPL', 115)
assert.equal(crossedIn.stockTicker, 'AAPL')
assert.equal(crossedIn.value, 115)

const deleted = db.delStock('AAPL')
assert.equal(deleted.stockTicker, 'AAPL')
assert.equal(db.getStock('AAPL'), undefined)
assert.equal(db.getStocks().length, 0)

db.close()
fs.unlinkSync(testDbPath)
console.log('db tests passed')
