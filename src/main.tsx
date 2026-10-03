import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PlaylistProvider } from './Playlist';
import './style.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><PlaylistProvider><App /></PlaylistProvider></React.StrictMode>);
