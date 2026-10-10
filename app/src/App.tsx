import { useState, useEffect, type SubmitEvent} from 'react'
import './App.css'


type Drop = { dropId: number; title: string; loc: string; quantity: number }

//const evtSource = new EventSource("sse-demo.php");
/*

evtSource.onmessage = (event) => {
  const newElement = document.createElement("li");
  const eventList = document.getElementById("list");

  newElement.textContent = `message: ${event.data}`;
  eventList.appendChild(newElement);
};

/**/

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

  const [title, setTitle] = useState('')
  const [loc, setLoc] = useState('')
  const [desc, setDesc] = useState('')
  const [quantity, setQuantity] = useState('')
  const [time, setTime] = useState('')
  const [drops, setDrops] = useState<Drop[]>([])

  //Listen in to live drop updates at /api/drops/stream
  useEffect( () => {
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
