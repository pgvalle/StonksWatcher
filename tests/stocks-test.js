const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

async function main() {
    process.env.STONKER_STOCK_PROVIDERS = 'stooq,yahoo'
    process.env.STONKER_POLL_INTERVAL_MS = '1'

    const stocks = require('../src/stocks')
    await stocks.init()

    assert.deepEqual(stocks.getProviderNames(), ['stooq', 'yahoo'])
    assert.deepEqual(stocks.getWatchedTickers(), [])
    assert.equal(stocks.isWatching('AAPL'), false)
    await stocks.close()

    const invalid = spawnSync(process.execPath, ['-e', "process.env.STONKER_STOCK_PROVIDER='nope'; process.env.STONKER_STOCK_PROVIDERS=''; require('./src/stocks').init().catch((err) => { console.error(err.message); process.exit(1) })"], {
        cwd: process.cwd(),
        encoding: 'utf8',
    })
    assert.notEqual(invalid.status, 0)
    assert.match(invalid.stderr, /Unknown stock provider/)

    const fallback = spawnSync(process.execPath, ['-e', "process.env.STONKER_STOCK_PROVIDER='stocksocket'; process.env.STONKER_STOCK_PROVIDERS=''; process.env.STONKER_FORCE_REALTIME_UNAVAILABLE='true'; const stocks = require('./src/stocks'); stocks.init().then(() => { console.log(stocks.getProviderNames().join(',')); stocks.close().then(() => process.exit(0)); }).catch((err) => { console.error(err); process.exit(1) })"], {
        cwd: process.cwd(),
        encoding: 'utf8',
    })
    assert.equal(fallback.status, 0)
    assert.match(fallback.stdout, /yahoo/)

    console.log('stocks tests passed')
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
