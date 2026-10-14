import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installFailureReporter } from './ui/failure-notice';
import './styles/motion.css';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');

// T45：兜住"没人 catch 的那一步"。挂在装配点而不是组件的 useEffect 里 ——
// 组件会被卸载重挂（切页签、错误边界重建），而这份监听器只该有一个、与应用同生命周期。
installFailureReporter();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
