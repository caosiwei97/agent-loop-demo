import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#4ec9b0',
          colorBgContainer: '#1e1e1e',
          colorBgElevated: '#252526',
          colorBorder: '#333',
          colorText: '#ccc',
          colorTextSecondary: '#888',
          borderRadius: 6,
          fontSize: 13,
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
