import express from 'express'
import { z } from 'zod'
import {pool } from './db'
import { startTimer, timingSummary, resetTimings } from './timing'

//Create Redis Server
import {createClient} from 'redis'
const client = createClient({url: "redis://localhost:6379" })
client.on("error", (err) => console.error(err)) 

const subscription = client.duplicate() 
subscription.on("error", (err) => console.error(err))

const app = express() 
app.use(express.json())

//Saves line to browsers that have connected to the server
const sseClients = new Set<express.Response>()
app.get('/api/drops/stream', (req, res) => { 
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-control': 'no-cache',
        'Connection': 'keep-alive'
    })
    res.flushHeaders()

    //Store the res line in sseClients
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))

})

app.get('/api/drops', async (req, res) => { 
    const timer = startTimer('list', res)
    try {
        //Rename columns to match the live SSE messages ({dropId, title, loc, quantity, endsAt}) so App.tsx sees one shape
        const result = await pool.query(
          `SELECT id AS "dropId", title, location AS loc, quantity, ends_at AS "endsAt"
           FROM drops
           WHERE ends_at > now()
           ORDER BY created_at DESC`
        )
        timer.mark('postgres')
        timer.done()
        res.json(result.rows)
    }
    catch(err) { 
        console.error(err)
        res.status(500).json({ error: 'Could not load drops' })
    }
})

//Per-step latency stats (p50/p99) for the benchmark script (npm run bench). 
app.get('/api/debug/timings', (req, res) => { res.json(timingSummary()) })
app.delete('/api/debug/timings', (req, res) => { resetTimings(); res.status(204).end() })


async function main() {
    await client.connect()
    

    await subscription.connect()

    //Save claims left over from before a restart, 
    //make sure every live drop has a Redis counter, then keep Postgres caught up
    await flushClaimsToPostgres()
    await rebuildRedisFromPostgres()
    startClaimFlusher()

    //Calls parameter function that relays message to clients when a new Drop appears in newDrops 
    await subscription.subscribe("newDrops", (message) => {
        for (const res of sseClients) { 
            res.write(`data: ${message} \n\n`)
        }
    })

    
    
    app.listen(3000, () => {console.log('1. Server running on local host 3000')})
}





//Defines Drop format 
const DropInput = z.object({ 
    title: z.string().min(1),
    loc: z.string().min(1), 
    desc: z.string(), 
    quantity: z.number().int().positive(), 
    time: z.number().int().positive() 
})

const ClaimInput = z.object({dropId: z.number().int().positive()})

type DropInput = z.infer<typeof DropInput> 


//Saves Drop to PostgreSQL Database    
async function saveDrop(drop: DropInput): Promise<{ id: number; endsAt: Date }> {
    const result = await pool.query(
        `INSERT INTO drops (title, location, description, quantity, ends_at)
        VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))
         RETURNING id, ends_at AS "endsAt"`,
        [drop.title, drop.loc, drop.desc, drop.quantity, drop.time]
    )
    return result.rows[0]
    //line that saves it to database 
}

//relays drop to redis to create a drop with certain quantity
async function relayRedis(id: number, drop: DropInput) {
    
    try { 
        const key = `drop:${id}`
        //create a drop in Redis
        await client.multi().hSet(key, 
            {
            title: drop.title,
            loc: drop.loc,
            desc: drop.desc,
            remaining: drop.quantity
            } 
        ).expire(key, drop.time * 60).exec()
    }
    catch (err) { 
        console.error(err)
        throw err
    }
}

//Redis is the source of truth for live counts. 
//Claims Postgres hasn't saved yet are counted here: field = dropId, value = how many
const PENDING_KEY = 'claims:pending'

//Runs inside Redis as ONE step, so two claims can't both take the last item.
//Missing key = expired or no such drop. Returns the new remaining count, or -1 if the claim is refused
const CLAIM_SCRIPT = `
local remaining = tonumber(redis.call('HGET', KEYS[1], 'remaining'))
if not remaining or remaining <= 0 then return -1 end
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
return redis.call('HINCRBY', KEYS[1], 'remaining', -1)
`

async function claimInRedis(id: number): Promise<number> {
    return Number(await client.eval(CLAIM_SCRIPT, { keys: [`drop:${id}`, PENDING_KEY], arguments: [String(id)] }))
}

//Reads and clears the pending counts in one step, so a claim made during the flush is kept for the next one
const TAKE_PENDING_SCRIPT = `
local all = redis.call('HGETALL', KEYS[1])
redis.call('DEL', KEYS[1])
return all
`

//Saves pending claims to Postgres: one UPDATE per drop no matter how many claims piled up since the last flush
async function flushClaimsToPostgres() {
    const flat = await client.eval(TAKE_PENDING_SCRIPT, { keys: [PENDING_KEY] }) as string[]
    for (let i = 0; i < flat.length; i += 2) {
        const id = flat[i]
        const count = Number(flat[i + 1])
        try {
            //quantity - count (not "= remaining") so updates are correct even if they land out of order
            await pool.query('UPDATE drops SET quantity = quantity - $1 WHERE id = $2', [count, id])
        }
        catch (err) {
            //put them back so the next flush retries instead of losing claims
            console.error('Could not save claims to Postgres, will retry', err)
            await client.hIncrBy(PENDING_KEY, id, count)
        }
    }
}

//Every FLUSH_MS, catch Postgres up with new info. 
//The flag stops a slow flush from overlapping the next one
const FLUSH_MS = 200
function startClaimFlusher() {
    let flushing = false
    setInterval(async () => {
        if (flushing) return
        flushing = true
        try { await flushClaimsToPostgres() }
        catch (err) { console.error(err) }
        finally { flushing = false }
    }, FLUSH_MS)
}

//If Redis loses data, recreate the data including counters for live drops from Postgres.
async function rebuildRedisFromPostgres() {
    const { rows } = await pool.query(
        `SELECT id, quantity, ends_at AS "endsAt" FROM drops WHERE ends_at > now() AND quantity > 0`
    )
    let rebuilt = 0
    for (const d of rows) {
        const key = `drop:${d.id}`
        if (await client.hSetNX(key, 'remaining', String(d.quantity))) {
            await client.expireAt(key, d.endsAt)
            rebuilt++
        }
    }
    if (rebuilt) console.log(`Rebuilt ${rebuilt} Redis counters from Postgres`)
}



//Receives post from App.tsx
app.post('/api/drops', async (req, res) => {
    const result = DropInput.safeParse(req.body)
    if (!result.success){ 
        res.status(400).json({error: result.error.issues[0].message})
        return
    }
    const drop = result.data
    const timer = startTimer('post', res)
    const { id: dropId, endsAt } = await saveDrop(drop)
    timer.mark('postgres')

    //relay drop to save it on Redis so we can keep updating the remaing value
    await relayRedis(dropId, drop)
    timer.mark('redis')

    //Send drop to Redis, which will relay to all subscribed servers
    await client.publish("newDrops", JSON.stringify({type: "New", dropId: dropId, title: drop.title, loc: drop.loc, quantity: drop.quantity, endsAt}))
    timer.mark('publish')
    timer.done()

    console.log("success"), res.status(201).json({dropId}) 
})

app.post('/api/claims', async (req, res) => {
    const result = ClaimInput.safeParse(req.body)
    
    //1. make sure req is a valid Number and valid dropId
    if (!result.success) { 
        res.status(400).json({error: result.error.issues[0].message})
        return 
    }
    
    //turn result into a number 
    const claimId = result.data.dropId

    //2. Redis decides: check and subtract in one Lua script (microseconds, no disk). Postgres catches up in the background flusher
    const timer = startTimer('claim', res)
    const new_quantity = await claimInRedis(claimId)
    timer.mark('redis')

    //-1 = sold out, expired, or no such drop. Nothing changed, so tell nobody else
    if (new_quantity < 0) {
        timer.done()
        res.status(409).json({error: 'Drop is sold out, expired, or does not exist'})
        return
    }

    //3. use client.publish to tell Redis to relay new count to all subscribed servers
    await client.publish("newDrops", JSON.stringify({type: "Claim", dropId: claimId, quantity: new_quantity  }))
    timer.mark('publish')
    timer.done()

    console.log("success"), res.status(201).json({claimId}) 

}

)


main().catch((err) => 
    {console.error("Startup Failed", err ) 
    process.exit(1)})
