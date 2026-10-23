import { useState, useEffect, useRef, type SubmitEvent} from 'react'
import './App.css'

//Display helper : "until 3:45 PM"
function endTime(endsAt: string) {
  return new Date(endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

//Small icons for the location / time line under each title
function PinIcon() {
  return (
    <svg className="meta-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="6.5" r="1.8" fill="currentColor" />
    </svg>
  )
}
function ClockIcon() {
  return (
    <svg className="meta-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 4.5V8l2.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}



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

  //the "Post a drop" popup (a native <dialog>, so Esc closes it for free)
  const postDialog = useRef<HTMLDialogElement>(null)

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
        postDialog.current?.close()
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



    <div className="app">
      <header className="topbar">
        <h1>FoodDrop</h1>
      </header>

      {/* The scrollable forum of drops */}
      <main className="feed">
        {drops.length === 0 && (
          <div className="empty">
            <h2>No food right now</h2>
            <p>Check back soon, or be the hero and post some.</p>
          </div>
        )}

        <ul className="drop-list">
          {drops.map((d) => (
              <li key = {d.dropId} className={`drop ${d.quantity === 0 ? 'gone' : ''}`}>
                <div className="drop-body">
                  <h2 className="drop-title">{d.title}</h2>
                  <p className="drop-meta">
                    <span><PinIcon />{d.loc}</span>
                    <span><ClockIcon />until {endTime(d.endsAt)}</span>
                  </p>
                </div>

                <div className="drop-actions">
                  <p className="drop-left"><strong>{d.quantity}</strong> left</p>
                  <button className="claim-btn" disabled={d.quantity === 0} onClick = {() => handleClaim(d)}>
                      {d.quantity === 0 ? 'All gone' : 'Claim'}
                  </button>
                </div>
              </li>
          ))}
        </ul>
      </main>

      {/* Bottom right: opens the post form */}
      <button className="post-btn" onClick={() => postDialog.current?.showModal()}>
        <span aria-hidden="true">+</span> Post a drop
      </button>

      {/* The post form, in a popup. Clicking the dim backdrop closes it */}
      <dialog ref={postDialog} className="post-dialog" onClick={e => { if (e.target === e.currentTarget) e.currentTarget.close() }}>
        <form onSubmit = {handleSubmit}>
          <h2>Post a drop</h2>

          <label>
            What's the food?
            <input required value = {title} onChange = { e => setTitle(e.target.value)} placeholder = 'Leftover pizza' />
          </label>
          <label>
            Description
            <input value = {desc} onChange = {e => setDesc(e.target.value)} placeholder = 'Cheese and pepperoni, still warm' />
          </label>
          <label>
            Where?
            <input required value = {loc} onChange = {e => setLoc(e.target.value)} placeholder = 'Bass Library, 2nd floor' />
          </label>
          <div className="field-row">
            <label>
              How many?
              <input required type = "number" min="1" value = {quantity} onChange = {e => setQuantity(e.target.value)} placeholder = '10' />
            </label>
            <label>
              Available for (min)
              <input required type = "number" min="1" value = {time} onChange = {e => setTime(e.target.value)} placeholder = '30' />
            </label>
          </div>

          <div className="dialog-actions">
            <button type="button" className="cancel-btn" onClick={() => postDialog.current?.close()}>Cancel</button>
            <button type = "submit" className="submit-btn">
              Post
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}

export default App
