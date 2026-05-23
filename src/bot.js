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
    sendMsg("You are my owner. Get help with `/h h`.", owner)
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
        await sendMsg(`You got something going on with ${db.formatRow(row)}`)
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

const trivia = `
Tickers are unique codes that identify companies in trading markets.
Examples: AAPL (Apple), TSLA (Tesla), NVDA (NVidia)
`

// COMMANDS
const cmds = {}

cmds.h = async (args) => {
    if (args.length != 1) {
        await sendMsg("Wrong number of args.")
        return
    }

    const thing = args[0].toLowerCase()
    if (thing == "ticker") {
        await sendMsg(trivia)
    } else {
        const help = cmds[thing]?.help
        await sendMsg(help || "I don't know this thing.")
    }
}

cmds.h.help = `\`\`\`
/h <thing>
  Help with a given "thing".
  - thing: h, a, d, s, i, ticker
  Example: /h ticker
\`\`\``

cmds.a = async (args) => {
    if (args.length != 1) {
        await sendMsg("Wrong number of args.")
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
        await sendMsg(`Added ${ticker} to the watchlist.`)
    } else {
        await sendMsg(`${ticker} is already in the watchlist.`)
    }
}

cmds.a.help = `\`\`\`
/a <ticker>
  Add a ticker to the watchlist.
  Example: /a TSLA
\`\`\``

cmds.d = async (args) => {
    if (args.length != 1) {
        await sendMsg("Wrong number of args.")
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
        await sendMsg(`Deleted ${ticker} from watchlist`)
    } else {
        await sendMsg(`${ticker} is not in the watchlist.`)
    }
}

cmds.d.help = `\`\`\`
/d <ticker>
  Delete a ticker from the watchlist.
  Example: /d TSLA
\`\`\``

cmds.s = async (args) => {
    if (args.length > 1) {
        await sendMsg("Wrong number of args.")
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
            await sendMsg(`${ticker} is not in the watchlist. Add it with \`/a ${ticker}\`.`)
        }

        return
    }

    const stocks = db.getStocks()
    if (stocks.length == 0) {
        await sendMsg("Watchlist is empty.")
    } else {
        const msg = stocks.reduce((acc, stock) => {
            return acc + `\n${stock.stockTicker}`
        }, "Known tickers:")
        await sendMsg(msg)
    }
}

cmds.s.help = `\`\`\`
/s [ticker]
  Show info on a given ticker.
  No arg shows all known tickers.
  Examples:
    /s
    /s NVDA
\`\`\``

cmds.i = async (args) => {
    if (args.length < 3 || args.length > 4) {
        await sendMsg("Wrong number of args.")
        return
    }

    const value = strTo2f(args[1])
    if (isNaN(value) || value < 1 || value > 1000) {
        await sendMsg("value must be a number between $1.00 and $1000.00")
        return
    }

    const diff = strTo2f(args[2])
    if (isNaN(diff) || diff < 0.01) {
        await sendMsg("diff must be a number equal or greater than $0.01")
        return
    }

    const upDiff = (args[3] ? strTo2f(args[3]) : diff)
    if (isNaN(upDiff) || upDiff < 0.01) {
        await sendMsg("upDiff must be a number equal or greater than $0.01")
        return
    }

    const ticker = parseTicker(args[0])
    if (!ticker) {
        await sendWrongTicker()
        return
    }

    const invested = db.invest(ticker, value, diff, upDiff)
    if (invested) {
        await sendMsg(db.formatRow(invested))
    } else if (db.getStock(ticker)) {
        await sendMsg(`No price info on ${ticker} yet.`)
    } else {
        await sendMsg(`${ticker} is not in the watchlist. Add it with \`/a ${ticker}\`.`)
    }
}

cmds.i.help = `\`\`\`
/i <ticker> <value> <diff> [upDiff]
  Invest and monitor value.
  Notify when it goes in/out of (value-diff,value+upDiff).
  - ticker: must be added with \`/a <ticker>\` first
  - value: must be between $1.00 and $1000.00
  - diff: must be equal or greater than $0.01
  - upDiff: upDiff=diff if omitted
  Examples:
    /i MSFT 500 5.00  → range: (495.00,505.00)
    /i GOOG 100 3 100 → range: (97.00,200.00)
\`\`\``

// RUNNING

// start watching stocks i have on the db
for (const stock of db.getStocks()) {
    sock.addTicker(stock.stockTicker, updateAndNotify);
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

const CMD_REGEX = /^\/(?<name>\S+)(?:\s+(?<args>.+))?$/
bot.onText(CMD_REGEX, async (msg, match) => {
    if (!isOwner(msg.chat.id)) return

    const invalid = async (_) => {
        await sendMsg("I don't know this command. Try `/h h`.")
    }

    const cmdName = match.groups.name.toLowerCase()
    const cmd = cmds[cmdName] || invalid
    const args = match.groups.args?.trim().split(/\s+/) || []

    try {
        await cmd(args)
    } catch (err) {
        console.error(`Command /${cmdName} failed:`, err)
        await sendMsg('Something went wrong while running that command.')
    }
})
