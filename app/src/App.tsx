import { useState, type SubmitEvent} from 'react'
import './App.css'





async function postDrop(title: string, loc: string, desc: string, quantity: number, time: number ){
    const c = await fetch ( '/api/drops', 
      { method: 'Post', headers: {'content-type': 'application/json'}, body: JSON.stringify({title, loc, desc, quantity, time})}
    )

    if (!c.ok) { 
      throw new Error('Post Failed')
    }

    return c 
}

function App() {

  const [title, setTitle] = useState('')
  const [loc, setLoc] = useState('')
  const [desc, setDesc] = useState('')
  const [quantity, setQuantity] = useState('')
  const [time, setTime] = useState('')
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

      

  
    </div> 
  )
}

export default App
