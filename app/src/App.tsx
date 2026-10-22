import { useState, useEffect, type SubmitEvent} from 'react'
import './App.css'


//endsAt is an ISO timestamp string (JSON turns the server's Date into a string)
type Drop = { dropId: number; title: string; loc: string; quantity: number; endsAt: string }


async function postDrop(title: string, loc: string, desc: string, quantity: number, time: number ){
    const c = await fetch ( '/api/drops', 
      { method: 'Post', headers: {'content-type': 'application/json'}, body: JSON.stringify({title, loc, desc, quantity, time})}
    )

    if (!c.ok) { 
      throw new Error('Post Failed')
    }

    return c 
}

async function postClaim(dropId: number) { 
  const c = await fetch ( 
    '/api/claims', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({dropId})}
  )
  if (!c.ok) { 
    throw new Error ('Claim Failed')
  }
  return c 
}



function App() {
  
  //title, loc, desc, quantity, time for CURRENT DROP YOU ARE TRYING TO POST, not of drops showing up on screen
  const [title, setTitle] = useState('')
  const [loc, setLoc] = useState('')
  const [desc, setDesc] = useState('')
  const [quantity, setQuantity] = useState('')
  const [time, setTime] = useState('')

  //drops of Drops FROM SERVER OTHERS HAVE POSTED
  const [drops, setDrops] = useState<Drop[]>([])

  //retrieve Drops on refresh or page opening 
  async function loadDrops(){ 
      const server_drops = await fetch ('/api/drops')
      const server_drops_json = await server_drops.json()
      setDrops(server_drops_json)
    }

  //await a get call to the server that receives all the current drops 
  


  //  setDrops ( .map(drops from serveer => drops) ) 

  //Listen in to live drop updates at /api/drops/stream
  useEffect( () => {
    

    loadDrops()
    const ev = new EventSource('/api/drops/stream') 
    ev.onmessage = (e) => { 

     const msg = JSON.parse(e.data)

     //if type == 'claim' in JSON.parse(e.data), use setDrops such as the atarget drop gets modified 
        //perhaps drops as a hashmap makes it easeir to find which drop you are talking about 
     //otherwise, type == 'post' and the new drop gets added to the list of setDrops
     if (msg.type == "Claim") { 
      setDrops(prev => prev.map(d => d.dropId===msg.dropId ? {...d, quantity: msg.quantity}: d))
     } 
     else{ 
      const drop : Drop = JSON.parse(e.data)
      setDrops((prev) => [drop, ...prev]) 
     }

     
    }
    return () => {
      ev.close()
    }

  }, []
  )

  //Every second, remove drops whose endsAt has passed so expired drops disappear without a refresh
  useEffect( () => {
    const timer = setInterval(() => {
      setDrops(prev => {
        const live = prev.filter(d => new Date(d.endsAt).getTime() > Date.now())
        //return the same array when nothing expired so React skips the re-render
        return live.length === prev.length ? prev : live
      })
    }, 1000)
    return () => clearInterval(timer)
  }, []
  )



  async function handleSubmit(e: SubmitEvent<HTMLFormElement>) { 
      e.preventDefault() 
      try { 
        await postDrop(title, loc, desc, Number(quantity), Number(time))
        setTitle('')
        setLoc('')
        setDesc('')
        setQuantity('')
        setTime('')
      
      }
      catch { 
        alert("Couldn't post, try again")
      }
  }

  async function handleClaim(d: Drop) { 

    try { 
      await postClaim(d.dropId) 
    }
    catch { 
      alert("Couldn't claim, try again")
    }
  }

  return (



    <div> 
      <h1>FoodDrop </h1>

      
      <form onSubmit = {handleSubmit}> 
        <input value = {title} onChange = { e => setTitle(e.target.value)} placeholder = 'Title' /> 
        <input value = {desc} onChange = {e => setDesc(e.target.value)} placeholder = 'Description' /> 
        <input value = {loc} onChange = {e => setLoc(e.target.value)} placeholder = 'Location' /> 
        <input type = "number" value = {quantity} onChange = {e => setQuantity(e.target.value)} placeholder = 'Quantity' /> 
        <input type = "number" value = {time} onChange = {e => setTime(e.target.value)} placeholder = 'Time Available' /> 
        <button type = "submit"> 
          Post 
        </button> 
      </form>

 
      <ul> 
        {drops.map((d) => (
            <li key = {d.dropId}> 
              {d.title} at {d.loc} with {d.quantity} left 
            
            <button onClick = {() => handleClaim(d)}> 
                claim 
             </button> 
            </li>  
        ))} 
      </ul>
  
    </div> 
  )
}

export default App
