import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './App';
import { BenchPage } from './pages/Bench';
import { HomePage } from './pages/Home';
import { OrderPage } from './pages/Order';
import { PlayPage } from './pages/Play';
import { ResultPage } from './pages/Result';
import './index.css';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/r/:id', element: <OrderPage /> },
      { path: '/r/:id/result', element: <ResultPage /> },
      { path: '/play', element: <PlayPage /> },
      { path: '/bench', element: <BenchPage /> },
    ],
  },
]);

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
