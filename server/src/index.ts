import express from 'express'
import { z } from 'zod'
import {pool } from './db'

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
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))

})

app.get('/api/drops', async (req, res) => { 
    try { 
        const result = await pool.query( 
            'Select id AS "dropId", title, location AS loc, description AS "desc", quantity FROM drops WHERE ends_at > now() and quantity > 0 ORDER BY id DESC'
        )
        res.json(result.rows)


    }
    catch(err) { 
        console.error(err)
        res.status(500).json({ error: 'Could not load drops' })
    }
})


async function main() { 
    await client.connect()
    

    await subscription.connect()
    
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
async function saveDrop(drop: DropInput): Promise<number> {
    const result = await pool.query( 
        `INSERT INTO drops (title, location, description, quantity, ends_at)
        VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))
         RETURNING id`,
        [drop.title, drop.loc, drop.desc, drop.quantity, drop.time]
    )
    return result.rows[0].id
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

//After a claim, relay to redis that it should update the quantity

async function updateRedis(id: number) { 
    try { 
        const key = `drop:${id}`

        //Keep all the other information, most importantly time until expiry the same, other than the remaining count 
        return await client.hIncrBy(key, 'remaining', -1)
    }
    catch (err) { 
        console.error(err)
        throw err
    }


}



//Receives post from App.tsx
app.post('/api/drops', async (req, res) => {
    const result = DropInput.safeParse(req.body)
    if (!result.success){ 
        res.status(400).json({error: result.error.issues[0].message})
        return
    }
    const drop = result.data
    const dropId = await saveDrop(drop) 

    //relay drop to save it on Redis so we can keep updating the remaing value 
    await relayRedis(dropId, drop)

    //Send drop to Redis, which will relay to all subscribed servers
    await client.publish("newDrops", JSON.stringify({type: "New", dropId: dropId, title: drop.title, loc: drop.loc, quantity: drop.quantity}))

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

    //2. use updateRedis() to update count of drop to Redis 
    const new_quantity = await updateRedis(claimId)

    //3. use client.publish to tell Redis to relay new count to all subscribed servers 
    await client.publish("newDrops", JSON.stringify({type: "Claim", dropId: claimId, quantity: new_quantity  }))

    //Also, sync PostGres count as well 
    await pool.query(  'UPDATE drops SET quantity = $1 WHERE id = $2', [new_quantity, claimId]) 
    
    console.log("success"), res.status(201).json({claimId}) 

}

)


main().catch((err) => 
    {console.error("Startup Failed", err ) 
    process.exit(1)})
