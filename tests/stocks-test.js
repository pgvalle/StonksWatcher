const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

process.env.STONKER_STOCK_PROVIDERS = 'stooq,yahoo'
process.env.STONKER_POLL_INTERVAL_MS = '1'

const stocks = require('../src/stocks')

assert.deepEqual(stocks.getProviderNames(), ['stooq', 'yahoo'])
assert.deepEqual(stocks.getWatchedTickers(), [])
assert.equal(stocks.isWatching('AAPL'), false)
stocks.close()

const invalid = spawnSync(process.execPath, ['-e', "process.env.STONKER_STOCK_PROVIDER='nope'; process.env.STONKER_STOCK_PROVIDERS=''; require('./src/stocks')"], {
    cwd: process.cwd(),
    encoding: 'utf8',
})
assert.notEqual(invalid.status, 0)
assert.match(invalid.stderr, /Unknown stock provider/)

console.log('stocks tests passed')
