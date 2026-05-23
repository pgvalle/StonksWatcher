const TelegramBot = require('node-telegram-bot-api') // https://github.com/yagop/node-telegram-bot-api
const sock = require('stocksocket') // https://github.com/gregtuc/StockSocket
const db = require('./db')

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!TOKEN) {
    console.error('Missing TELEGRAM_BOT_TOKEN environment variable.')
    process.exit(1)
}

const bot = new TelegramBot(TOKEN, { polling: true })
let owner = null

async function sendMsg(str, chatId = owner) {
    if (!chatId) {
        console.warn('Skipping Telegram message because no owner is set yet.')
        return
    }

    await bot.sendMessage(chatId, str, { parse_mode: 'Markdown' })
}

function isOwner(chatId) {
    if (owner) return owner === chatId

    owner = chatId
    sendMsg("You are my owner. Get help with `/h` or `/help`.", owner)
        .catch((err) => console.error('Failed to send owner welcome message:', err))
    return true
}

// update stock info in db and notify owner
async function updateAndNotify(data) {
    const ticker = parseTicker(data.id)
    const price = Number(data.price)
    if (!ticker || !Number.isFinite(price) || price <= 0) return

    const row = db.updateStock(ticker, price)
    if (row) {
        await sendMsg(`Alert for ${ticker}:\n${db.formatRow(row)}`)
    }
}

// round to 2 decimal places
function strTo2f(x) {
    return Number(Number(x).toFixed(2))
}

function parseTicker(raw) {
    const ticker = raw?.toUpperCase()
    return /^[A-Z0-9.-]{1,8}$/.test(ticker) ? ticker : undefined
}

async function sendWrongTicker() {
    await sendMsg('Ticker must be 1-8 chars using letters, numbers, dot, or dash.')
}

function stripSlash(command) {
    return command.replace(/^\//, '').toLowerCase()
}

const trivia = `
Tickers are unique codes that identify companies in trading markets.
Examples: AAPL (Apple), TSLA (Tesla), NVDA (NVidia)
`

// COMMANDS
const cmds = {}
const commandDefs = []

function formatAliases(names) {
    return names.map((name) => `/${name}`).join(', ')
}

function formatHelp(def) {
    const lines = [
        formatAliases(def.names),
        def.summary,
        '',
        `Usage: ${def.usage}`,
    ]

    if (def.details?.length) {
        lines.push('', ...def.details)
    }

    if (def.examples?.length) {
        lines.push('', 'Examples:', ...def.examples)
    }

    return ['```', ...lines, '```'].join('\n')
}

function registerCommand(def) {
    commandDefs.push(def)
    def.run.help = formatHelp(def)
    def.run.names = def.names

    for (const name of def.names) {
        cmds[name] = def.run
    }
}

function commandList() {
    const lines = commandDefs.map((def) => {
        const aliases = def.names.slice(1).map((name) => `/${name}`).join(', ')
        return `/${def.names[0]}${aliases ? ` (${aliases})` : ''} - ${def.summary}`
    })

    return [
        'Commands:',
        ...lines,
        '',
        'Use `/h <command>` or `/help <command>` for details.',
        'Example: `/h invest`',
    ].join('\n')
}

async function helpCommand(args) {
    if (args.length > 1) {
        await sendMsg('Wrong number of args. Use `/h` or `/h <command>`.')
        return
    }

    if (args.length == 0) {
        await sendMsg(commandList())
        return
    }

    const thing = stripSlash(args[0])
    if (thing == 'ticker') {
        await sendMsg(trivia)
        return
    }

    const help = cmds[thing]?.help
    await sendMsg(help || "I don't know this thing. Use `/h` to list commands.")
}

registerCommand({
    names: ['h', 'help'],
    summary: 'Show command help.',
    usage: '/h [command|ticker]',
    details: [
        'No arg lists all commands.',
        'Use ticker for a quick explanation of stock tickers.',
    ],
    examples: ['/h', '/help invest', '/h ticker'],
    run: helpCommand,
})

async function watchCommand(args) {
    if (args.length != 1) {
        await sendMsg('Wrong number of args. Use `/w <ticker>`.')
        return
    }

    const ticker = parseTicker(args[0])
    if (!ticker) {
        await sendWrongTicker()
        return
    }

    const added = db.addStock(ticker)
    if (added) {
        sock.addTicker(ticker, updateAndNotify)
        await sendMsg(`Watching ${ticker}.`)
    } else {
        await sendMsg(`${ticker} is already in the watchlist.`)
    }
}

registerCommand({
    names: ['w', 'watch', 'a', 'add'],
    summary: 'Watch a ticker.',
    usage: '/w <ticker>',
    details: ['Aliases /a and /add are kept for muscle memory.'],
    examples: ['/w TSLA', '/watch NVDA'],
    run: watchCommand,
})

async function unwatchCommand(args) {
    if (args.length != 1) {
        await sendMsg('Wrong number of args. Use `/u <ticker>`.')
        return
    }

    const ticker = parseTicker(args[0])
    if (!ticker) {
        await sendWrongTicker()
        return
    }

    sock.removeTicker(ticker)

    const deleted = db.delStock(ticker)
    if (deleted) {
        await sendMsg(`Stopped watching ${ticker}.`)
    } else {
        await sendMsg(`${ticker} is not in the watchlist.`)
    }
}

registerCommand({
    names: ['u', 'unwatch', 'd', 'del', 'delete', 'rm', 'remove'],
    summary: 'Stop watching a ticker.',
    usage: '/u <ticker>',
    details: ['Deleting a watched ticker also deletes its investment alert.'],
    examples: ['/u TSLA', '/unwatch NVDA'],
    run: unwatchCommand,
})

async function stockCommand(args) {
    if (args.length > 1) {
        await sendMsg('Wrong number of args. Use `/s [ticker]`.')
        return
    }

    if (args.length == 1) {
        const ticker = parseTicker(args[0])
        if (!ticker) {
            await sendWrongTicker()
            return
        }

        const stock = db.getStock(ticker)
        if (stock) {
            await sendMsg(db.formatRow(stock))
        } else {
            await sendMsg(`${ticker} is not in the watchlist. Watch it with \`/w ${ticker}\`.`)
        }

        return
    }

    const stocks = db.getStocks()
    if (stocks.length == 0) {
        await sendMsg('Watchlist is empty.')
        return
    }

    const msg = stocks.map(db.formatRow).join('\n\n')
    await sendMsg(`Watchlist:\n\n${msg}`)
}

registerCommand({
    names: ['s', 'stock', 'l', 'list'],
    summary: 'Show one ticker or the full watchlist.',
    usage: '/s [ticker]',
    details: ['No arg lists the full watchlist.'],
    examples: ['/s', '/stock NVDA', '/list'],
    run: stockCommand,
})

async function investCommand(args) {
    if (args.length < 3 || args.length > 4) {
        await sendMsg('Wrong number of args. Use `/i <ticker> <value> <downDiff> [upDiff]`.')
        return
    }

    const ticker = parseTicker(args[0])
    if (!ticker) {
        await sendWrongTicker()
        return
    }

    const value = strTo2f(args[1])
    if (isNaN(value) || value < 1 || value > 1000) {
        await sendMsg('value must be a number between $1.00 and $1000.00')
        return
    }

    const downDiff = strTo2f(args[2])
    if (isNaN(downDiff) || downDiff < 0.01) {
        await sendMsg('downDiff must be a number equal or greater than $0.01')
        return
    }

    const upDiff = (args[3] ? strTo2f(args[3]) : downDiff)
    if (isNaN(upDiff) || upDiff < 0.01) {
        await sendMsg('upDiff must be a number equal or greater than $0.01')
        return
    }

    const invested = db.invest(ticker, value, downDiff, upDiff)
    if (invested) {
        await sendMsg(db.formatRow(invested))
    } else if (db.getStock(ticker)) {
        await sendMsg(`No price info on ${ticker} yet. Wait for the first price update, then try again.`)
    } else {
        await sendMsg(`${ticker} is not in the watchlist. Watch it with \`/w ${ticker}\`.`)
    }
}

registerCommand({
    names: ['i', 'invest'],
    summary: 'Create or replace an investment alert.',
    usage: '/i <ticker> <value> <downDiff> [upDiff]',
    details: [
        'Notify when the simulated investment moves outside or back inside the range.',
        'ticker must already be watched with /w.',
        'value must be between $1.00 and $1000.00.',
        'downDiff and upDiff must be at least $0.01.',
        'upDiff defaults to downDiff when omitted.',
    ],
    examples: [
        '/i MSFT 500 5.00  -> range: 495.00 to 505.00',
        '/invest GOOG 100 3 100 -> range: 97.00 to 200.00',
    ],
    run: investCommand,
})

// RUNNING

// start watching stocks i have on the db
for (const stock of db.getStocks()) {
    sock.addTicker(stock.stockTicker, updateAndNotify)
}

const MSG_REGEX = /^(?!\/\S).+/s
bot.onText(MSG_REGEX, async (msg) => {
    if (!isOwner(msg.chat.id)) return

    try {
        await sendMsg(msg.text)
    } catch (err) {
        console.error('Message handler failed:', err)
    }
})

const CMD_REGEX = /^\/(?<name>\S+)(?:\s+(?<args>.*))?$/
bot.onText(CMD_REGEX, async (msg, match) => {
    if (!isOwner(msg.chat.id)) return

    const invalid = async (_) => {
        await sendMsg("I don't know this command. Use `/h` to list commands.")
    }

    const cmdName = match.groups.name.toLowerCase().split('@')[0]
    const cmd = cmds[cmdName] || invalid
    const rawArgs = match.groups.args?.trim()
    const args = rawArgs ? rawArgs.split(/\s+/) : []

    try {
        await cmd(args)
    } catch (err) {
        console.error(`Command /${cmdName} failed:`, err)
        await sendMsg('Something went wrong while running that command.')
    }
})
