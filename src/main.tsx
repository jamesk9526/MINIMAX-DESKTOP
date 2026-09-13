import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import MobileApp from './MobileApp'
import { MovieEditorWindow } from './MovieEditorWindow'
import { installBrowserMock } from './browserMock'
import './styles.css'
import './guided-studio.css'

installBrowserMock()

const mobile = new URLSearchParams(location.search).get('mobile') === '1'
const movieEditor = new URLSearchParams(location.search).get('movieEditor') === '1'
document.documentElement.classList.toggle('mobile-route', mobile)
document.documentElement.classList.toggle('movie-editor-route', movieEditor)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {movieEditor ? <MovieEditorWindow /> : mobile ? <MobileApp /> : <App />}
  </StrictMode>,
)
