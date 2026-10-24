import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './home-shanshui.css';
import './journal-qingming.css';
import './books-study.css';
import './book-detail.css';
import './page-motion.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
