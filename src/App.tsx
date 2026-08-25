import { TrackPanel } from './components/TrackPanel'
import './App.css'

function App() {
  return (
    <div className="app">
      <header>
        <h1>Runify</h1>
        <p className="subtitle">Build your running mix</p>
      </header>
      <main>
        <TrackPanel />
      </main>
    </div>
  )
}

export default App
