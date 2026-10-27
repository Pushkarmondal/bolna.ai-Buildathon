import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout, NotFound, RouteError } from './App';
import { onSignedOut } from './api';
import { HomePage } from './pages/Home';
import './index.css';

// Home comes with the app; every other page is its own file, fetched the first time it is opened.
const OrderPage = lazy(() => import('./pages/Order').then((m) => ({ default: m.OrderPage })));
const ResultPage = lazy(() => import('./pages/Result').then((m) => ({ default: m.ResultPage })));
const PricesPage = lazy(() => import('./pages/Prices').then((m) => ({ default: m.PricesPage })));
const PlayPage = lazy(() => import('./pages/Play').then((m) => ({ default: m.PlayPage })));
const BenchPage = lazy(() => import('./pages/Bench').then((m) => ({ default: m.BenchPage })));
const ProofPage = lazy(() => import('./pages/Proof').then((m) => ({ default: m.ProofPage })));

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      {
        // A page that fails to load or render shows inside the header and nav, not on a blank screen.
        errorElement: <RouteError />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/r/:id', element: <OrderPage /> },
          { path: '/r/:id/result', element: <ResultPage /> },
          { path: '/prices', element: <PricesPage /> },
          { path: '/play', element: <PlayPage /> },
          { path: '/bench', element: <BenchPage /> },
          { path: '/proof', element: <ProofPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
onSignedOut(() => queryClient.setQueryData(['auth'], { authenticated: false }));

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
