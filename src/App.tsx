import { useState } from 'react'
import { TrackPanel } from './components/TrackPanel'
import './App.css'

function App() {
  const [slots, setSlots] = useState<string[]>([crypto.randomUUID()])

  function addSlot() {
    setSlots((prev) => [...prev, crypto.randomUUID()])
  }

  function removeSlot(id: string) {
    setSlots((prev) => prev.filter((slotId) => slotId !== id))
  }

  return (
    <div className="app">
      <header>
        <h1>Runify</h1>
        <p className="subtitle">Build your running mix</p>
      </header>
      <main>
        {slots.map((id, index) => (
          <TrackPanel key={id} index={index} onRemove={() => removeSlot(id)} />
        ))}
        <button type="button" className="add-song-button" onClick={addSlot}>
          + Add another song
        </button>
      </main>
    </div>
  )
}

export default App
