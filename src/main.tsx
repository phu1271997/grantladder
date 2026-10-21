import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ChainProvider } from "./lib/chain";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Create from "./pages/Create";
import Grant from "./pages/Grant";
import Explorer from "./pages/Explorer";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ChainProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/create" element={<Create />} />
            <Route path="/grants" element={<Grant />} />
            <Route path="/grants/:id" element={<Grant />} />
            <Route path="/explorer" element={<Explorer />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ChainProvider>
    </BrowserRouter>
  </StrictMode>,
);
