import express from 'express'
import { z } from 'zod'
import {pool } from './db'

//Create Redis Server
import {createClient} from 'redis'
const client = createClient({url: "redis://localhost:6379" })
client.on("error", (err) => console.error(err)) 

async function main() { 
    await client.connect()
    app.listen(3000, () => {console.log('Server running on local host 3000')})

}
main().catch((err) => 
    {console.error("Startup Failed", err ) 
    process.exit(1)})


const app = express() 
app.use(express.json())

//Defines Drop format 
const DropInput = z.object({ 
    title: z.string().min(1),
    loc: z.string().min(1), 
    desc: z.string(), 
    quantity: z.number().int().positive(), 
    time: z.number().int().positive() 
})

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

//relayDrop to redis to create a drop with certain quantity
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



//Receives post from app 
app.post('/api/drops', async (req, res) => {
    const result = DropInput.safeParse(req.body)
    if (!result.success){ 
        res.status(400).json({error: result.error.issues[0].message})
        return
    }
    const drop = result.data
    const dropId = await saveDrop(drop) 
    await relayRedis(dropId, drop)

    console.log("success"), res.status(201).json({dropId}) 
})







app.listen(3000, () => {
  console.log('Server running on http://localhost:3000')   // ← this line prints the message
})